'use client';

import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import dynamic from 'next/dynamic';
import { PublicKey, SystemProgram, Transaction, TransactionInstruction, VersionedTransaction, TransactionMessage, ComputeBudgetProgram } from '@solana/web3.js';
import { useState, useEffect, useRef } from 'react';
import { Program, AnchorProvider, BN } from "@coral-xyz/anchor";
import idl from "./idl/fallback_protocol.json";
import { pollSignatureConfirmation } from "@/lib/confirmTransaction";
import Link from "next/link";
import { WalletHelpModal } from "../components/WalletHelpModal";

const WalletMultiButton = dynamic(
    async () => (await import('@solana/wallet-adapter-react-ui')).WalletMultiButton,
    { ssr: false }
);

const PROGRAM_ID = new PublicKey("H8FYdjnCybk2vzbAKKKUbCiQQrohEjAwCXCo11gETnqT");
const ROBOT_PUBKEY = new PublicKey("9kRjRmidhpzdCUckaG4wRKXmqfnDixT4xz6uppEga6b7");

const SESSION_STATUS_BYTE_OFFSET = 96;
const SESSION_STATUS_SLASHED = 3;

const PROFILES = {
    delivery: {
        id: "Delivery Robot #01",
        type: "Light Courier",
        location: "Warehouse Sector 7",
        bountySol: 0.1, stakeSol: 0.05, stakeLamports: 50_000_000,
        warning: "Robot encountered an unmapped dynamic obstacle. Requires manual teleoperation clearance.",
        tagColor: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30", boxBorder: "border-emerald-500/30", boxBg: "bg-emerald-950/20", accent: "bg-emerald-500"
    },
    robotaxi: {
        id: "Robotaxi #01",
        type: "Autonomous Passenger Vehicle",
        location: "Downtown Intersection (4th & Pike)",
        bountySol: 1.0, stakeSol: 0.5, stakeLamports: 500_000_000,
        warning: "CRITICAL: Vehicle blocked in active traffic lane. Immediate human override required to ensure passenger safety.",
        tagColor: "bg-amber-500/20 text-amber-400 border-amber-500/30", boxBorder: "border-amber-500/30", boxBg: "bg-amber-950/20", accent: "bg-amber-500"
    }
};

type ProfileKey = keyof typeof PROFILES;
type NavTab = 'work' | 'earnings' | 'training';
type WorkState = 'lobby' | 'searching' | 'active';

export default function Home() {
    const { connection } = useConnection();
    const { publicKey, connected, sendTransaction, disconnect, wallet } = useWallet();

    const [currentTab, setCurrentTab] = useState<NavTab>('work');
    const [workState, setWorkState] = useState<WorkState>('lobby');
    const [totalEarnings, setTotalEarnings] = useState<number>(0);
    const [tasksResolved, setTasksResolved] = useState<number>(0);
    const [weeklyData, setWeeklyData] = useState<number[]>([0, 0, 0, 0, 0, 0, 0]);
    const [weeklyEarnings, setWeeklyEarnings] = useState<number[]>([0, 0, 0, 0, 0, 0, 0]);
    const [showWalletDetails, setShowWalletDetails] = useState<boolean>(false);
    const [showDisconnectConfirm, setShowDisconnectConfirm] = useState<boolean>(false);

    // ── Diagnostic test (hidden, ?debug=true only) ──
    // Defer useSearchParams to useEffect — calling it during render breaks
    // Next.js prerender. isDebugMode defaults to false (SSR-safe), then
    // updated on mount when the URL is available client-side.
    const [isDebugMode, setIsDebugMode] = useState<boolean>(false);
    const [debugTxStatus, setDebugTxStatus] = useState<string>('');
    const [debugTxSignature, setDebugTxSignature] = useState<string | null>(null);
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        setIsDebugMode(params.get('debug') === 'true');
    }, []);

    const [isTrainingMode, setIsTrainingMode] = useState<boolean>(false);

    const [status, setStatus] = useState<string>("Awaiting Operator Action...");
    const [sessionId, setSessionId] = useState<number | null>(null);
    const [activeProfile, setActiveProfile] = useState<ProfileKey>('delivery');

    const [isTaskAccepted, setIsTaskAccepted] = useState<boolean>(false);
    const [isRobotReady, setIsRobotReady] = useState<boolean>(false);
    const [isTaskResolved, setIsTaskResolved] = useState<boolean>(false);
    const [isTaskSlashed, setIsTaskSlashed] = useState<boolean>(false);
    const [slashSignature, setSlashSignature] = useState<string | null>(null);
    const [resolveSignature, setResolveSignature] = useState<string | null>(null);
    const [showReceiptModal, setShowReceiptModal] = useState<boolean>(false);
    const [isTaskCleared, setIsTaskCleared] = useState<boolean>(false);
    const [isLocalhost, setIsLocalhost] = useState<boolean>(false);

    // Defer localhost detection to client side to avoid hydration mismatch.
    // SSR renders without the warning; client adds it after mounting.
    useEffect(() => {
        setIsLocalhost(window.location.hostname === 'localhost');
    }, []);

    const [rosConnected, setRosConnected] = useState<boolean>(false);
    const [activeKeys, setActiveKeys] = useState<{ [key: string]: boolean }>({});
    const wsRef = useRef<WebSocket | null>(null);
    const activeKeysRef = useRef<{ w: boolean, a: boolean, s: boolean, d: boolean }>({ w: false, a: false, s: false, d: false });

    // -------------------------------------------------------------
    // UTILITY: Timeout Wrapper for Async Operations
    // -------------------------------------------------------------
    const withTimeout = <T,>(promise: Promise<T>, ms: number, label: string): Promise<T> =>
        Promise.race([
            promise,
            new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms)
            ),
        ]);

    // -------------------------------------------------------------
    // UTILITY: Foolproof Little-Endian Session PDA Derivation
    // -------------------------------------------------------------
    const deriveSessionPda = (rawSessionId: number | string): PublicKey => {
        const cleanSessionId = parseInt(String(rawSessionId), 10);
        const sessionIdArray = new Uint8Array(8);
        new DataView(sessionIdArray.buffer).setBigUint64(0, BigInt(cleanSessionId), true);

        const [sessionPda] = PublicKey.findProgramAddressSync([
            new TextEncoder().encode("session"),
            ROBOT_PUBKEY.toBytes(),
            sessionIdArray
        ], PROGRAM_ID);

        return sessionPda;
    };

    // Shared Anchor Program Builder
    const getProgram = () => {
        if (!wallet) throw new Error("Wallet not connected");
        const provider = new AnchorProvider(connection as any, wallet.adapter as any, {
            preflightCommitment: "confirmed",
            commitment: "confirmed",
        });
        return new Program(idl as any, provider);
    };

    // 1. Initial Session Check
    useEffect(() => {
        fetch('/api/session?t=' + new Date().getTime())
            .then(res => res.json())
            .then(data => {
                if (data.session_id !== undefined) setSessionId(data.session_id);
            })
            .catch(err => console.error(err));
    }, []);

    // 2. Poll for New Incidents
    useEffect(() => {
        if (workState !== 'searching') return;
        const interval = setInterval(async () => {
            try {
                const res = await fetch('/api/session?t=' + new Date().getTime());
                const data = await res.json();
                if (data.status === 'locked' && sessionId !== null && data.session_id >= sessionId) {
                    setSessionId(data.session_id);
                    setWorkState('active');
                    setStatus("Waiting for Operator Stake...");
                }
            } catch (e) {}
        }, 1500);
        return () => clearInterval(interval);
    }, [workState, sessionId]);

    // 3. Session Status Watchdog (Detects On-Chain Slashing)
    useEffect(() => {
        if (workState !== 'active' || !isTaskAccepted || isTaskResolved || isTaskSlashed || sessionId === null) return;
        const interval = setInterval(async () => {
            try {
                const sessionPda = deriveSessionPda(sessionId);

                // Use Anchor decoder if wallet is connected, else fallback to raw byte check
                if (wallet) {
                    const program = getProgram();
                    const sessionAccount = await (program.account as any).session.fetchNullable(sessionPda);
                    if (sessionAccount && sessionAccount.status === SESSION_STATUS_SLASHED) {
                        setIsTaskSlashed(true);
                        setStatus("❌ TIMEOUT: Slashed by robot watchdog.");
                    }
                } else {
                    const accInfo = await connection.getAccountInfo(sessionPda, 'confirmed');
                    if (accInfo && accInfo.data && accInfo.data[SESSION_STATUS_BYTE_OFFSET] === SESSION_STATUS_SLASHED) {
                        setIsTaskSlashed(true);
                        setStatus("❌ TIMEOUT: Slashed by robot watchdog.");
                    }
                }
            } catch (e) {}
        }, 2000);
        return () => clearInterval(interval);
    }, [workState, isTaskAccepted, isTaskResolved, isTaskSlashed, sessionId, connection, wallet]);

    // 4. Poll Local Robot Mock/Daemon API
    useEffect(() => {
        if (workState !== 'active' || !isTaskAccepted || isTaskResolved) return;
        const interval = setInterval(async () => {
            try {
                const res = await fetch('/api/robot?t=' + new Date().getTime());
                const data = await res.json();

                if (data.ready && !isTaskSlashed) {
                    setIsRobotReady(true);
                    if (data.resolved) {
                        setIsTaskCleared(true);
                        setStatus("✅ Robot confirmed clearance! Ready to claim bounty.");
                    } else {
                        setStatus("📡 Teleoperation Active: Resolve the deadlock...");
                    }
                } else if (data.slashed) {
                    setIsTaskSlashed(true);
                    setSlashSignature(data.tx);
                    setStatus("❌ TIMEOUT: Slashed by robot watchdog.");
                }
            } catch (e) {}
        }, 2000);
        return () => clearInterval(interval);
    }, [workState, isTaskAccepted, isTaskResolved, isTaskSlashed]);

    // 5. ROS 2 WebSocket Bridge & WASD Input Handler
    useEffect(() => {
        const shouldConnectToRos = (isTaskAccepted && !isTaskResolved && !isTaskSlashed) || isTrainingMode;

        if (shouldConnectToRos) {
            const ws = new WebSocket('ws://127.0.0.1:9090');

            ws.onopen = () => {
                setRosConnected(true);
                ws.send(JSON.stringify({ op: 'advertise', topic: '/cmd_vel', type: 'geometry_msgs/TwistStamped' }));
            };
            ws.onclose = () => setRosConnected(false);
            ws.onerror = () => setRosConnected(false);
            wsRef.current = ws;

            const handleKeyDown = (e: KeyboardEvent) => {
                if (e.repeat) return;
                const key = e.key.toLowerCase();
                if (['w', 'a', 's', 'd'].includes(key)) {
                    activeKeysRef.current = { ...activeKeysRef.current, [key]: true };
                    setActiveKeys({ ...activeKeysRef.current });
                }
            };

            const handleKeyUp = (e: KeyboardEvent) => {
                const key = e.key.toLowerCase();
                if (['w', 'a', 's', 'd'].includes(key)) {
                    activeKeysRef.current = { ...activeKeysRef.current, [key]: false };
                    setActiveKeys({ ...activeKeysRef.current });
                }
            };

            window.addEventListener('keydown', handleKeyDown);
            window.addEventListener('keyup', handleKeyUp);

            const pubInterval = setInterval(() => {
                if (ws.readyState !== WebSocket.OPEN) return;
                const keys = activeKeysRef.current;
                let linear = 0.0, angular = 0.0;
                const speed = 0.3, turnSpeed = 0.5;

                if (keys.w) linear = speed;
                if (keys.s) linear = -speed;
                if (keys.a) angular = turnSpeed;
                if (keys.d) angular = -turnSpeed;

                ws.send(JSON.stringify({
                    op: 'publish', topic: '/cmd_vel',
                    msg: { header: { stamp: { sec: 0, nanosec: 0 }, frame_id: 'base_link' }, twist: { linear: { x: linear, y: 0.0, z: 0.0 }, angular: { x: 0.0, y: 0.0, z: angular } } }
                }));
            }, 33);

            return () => {
                window.removeEventListener('keydown', handleKeyDown);
                window.removeEventListener('keyup', handleKeyUp);
                clearInterval(pubInterval);
                if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                    wsRef.current.send(JSON.stringify({ op: 'unadvertise', topic: '/cmd_vel' }));
                    wsRef.current.close();
                }
            };
        }
    }, [isTaskAccepted, isTaskResolved, isTaskSlashed, isTrainingMode]);

    // -------------------------------------------------------------
    // ON-CHAIN TRANSACTIONS
    // -------------------------------------------------------------
    const acceptTask = async () => {
        if (!publicKey || !wallet || !connected || sessionId === null) {
            if (!wallet || !connected) {
                setStatus("⚠️ Wallet not connected. Please connect your wallet first.");
            } else if (sessionId === null) {
                setStatus("⚠️ No active incident session found.");
            }
            return;
        }

        console.log("[acceptTask] Starting task acceptance for session:", sessionId, "Wallet:", publicKey.toBase58());
        setStatus("🔍 Verifying session on Solana Devnet...");

        try {
            const sessionPda = deriveSessionPda(sessionId);
            console.log("[acceptTask] Derived session PDA:", sessionPda.toBase58());

            // Auto-retry: wait for on-chain confirmation with backoff
            let sessionAccountInfo = null;
            for (let attempt = 0; attempt < 5; attempt++) {
                console.log(`[acceptTask] Fetching session account info (attempt ${attempt + 1}/5)...`);
                sessionAccountInfo = await withTimeout(
                    connection.getAccountInfo(sessionPda, 'confirmed'),
                    10000,
                    'Checking on-chain session'
                );
                if (sessionAccountInfo) {
                    console.log("[acceptTask] Session account confirmed on-chain!");
                    break;
                }
                setStatus(`⏳ Waiting for on-chain session confirmation... (${attempt + 1}/5)`);
                await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
            }
            if (!sessionAccountInfo) {
                setStatus("❌ Session not found on-chain. Robot incident may still be initializing.");
                return;
            }

            setStatus("🔨 Building transaction instruction...");
            console.log("[acceptTask] Building Anchor instruction...");
            const program = getProgram();
            const bondLamports = new BN(PROFILES[activeProfile].stakeLamports);

            const acceptTaskIx = await withTimeout<TransactionInstruction>(
                (program.methods as any)
                    .acceptTask(bondLamports)
                    .accounts({
                        operator: publicKey,
                        session: sessionPda,
                        systemProgram: SystemProgram.programId,
                    })
                    .instruction(),
                10000,
                'Building acceptTask instruction'
            );
            console.log("[acceptTask] Instruction built successfully:", acceptTaskIx);

            setStatus("🌐 Fetching latest blockhash...");
            console.log("[acceptTask] Fetching blockhash...");
            const latestBlockhash = await withTimeout(
                connection.getLatestBlockhash('confirmed'),
                15000,
                'Fetching latest blockhash'
            );
            console.log("[acceptTask] Recent blockhash:", latestBlockhash.blockhash);

            setStatus("📝 Assembling transaction...");
            let signature: string;
            try {
                const messageV0 = new TransactionMessage({
                    payerKey: publicKey,
                    recentBlockhash: latestBlockhash.blockhash,
                    instructions: [
                        ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
                        acceptTaskIx,
                    ],
                }).compileToV0Message();

                const transaction = new VersionedTransaction(messageV0);
                console.log("[acceptTask] Transaction compiled. Running local simulation...");

                // Simulate locally with sigVerify: false to test instruction logic
                // without requiring signatures (transaction is unsigned at this point).
                // Omitting sigVerify (defaulting to true) can cause Phantom's own
                // pre-approval simulation to fail even when the instruction is valid.
                const debugSim = await withTimeout(
                    connection.simulateTransaction(transaction, {
                        commitment: 'confirmed',
                        sigVerify: false,
                    }),
                    10000,
                    'Local simulation'
                );
                if (debugSim.value.err) {
                    console.error("[acceptTask] Local simulation FAILED:",
                        JSON.stringify(debugSim.value.err, null, 2));
                } else {
                    console.log("[acceptTask] Local simulation OK.",
                        debugSim.value.returnData
                            ? `return data: ${JSON.stringify(debugSim.value.returnData)}`
                            : 'no return data');
                }

                // Log instruction details for comparing local vs Phantom simulation
                console.log("[acceptTask] Instruction programId:", acceptTaskIx.programId.toBase58());
                console.log("[acceptTask] Instruction accounts:", acceptTaskIx.keys.map(k =>
                    `${k.pubkey.toBase58()}: ${k.isSigner ? 'signer' : 'readonly'}/${k.isWritable ? 'writable' : 'readonly'}`
                ).join(', '));
                console.log("[acceptTask] Instruction data (hex):", Buffer.from(acceptTaskIx.data).toString('hex'));
                console.log("[acceptTask] Operator:", publicKey.toBase58());
                console.log("[acceptTask] Session PDA:", sessionPda.toBase58());
                console.log("[acceptTask] Blockhash:", latestBlockhash.blockhash.toString());

                setStatus("🔐 Check your wallet extension — approve transaction...");
                console.log("[acceptTask] Calling sendTransaction...");
                signature = await withTimeout(
                    sendTransaction(transaction, connection, {
                        skipPreflight: true,
                        preflightCommitment: 'confirmed'
                    }),
                    60000,
                    'Wallet approval'
                );
            } catch (v0Error: any) {
                console.warn("[acceptTask] VersionedTransaction failed, attempting legacy Transaction fallback:", v0Error);
                if (v0Error?.message?.includes("version") || v0Error?.name === "WalletSendTransactionError") {
                    const legacyTx = new Transaction().add(acceptTaskIx);
                    legacyTx.recentBlockhash = latestBlockhash.blockhash;
                    legacyTx.feePayer = publicKey;
                    setStatus("🔐 Check your wallet extension — approve transaction (legacy mode)...");
                    signature = await withTimeout(
                        sendTransaction(legacyTx, connection, {
                            skipPreflight: true,
                            preflightCommitment: 'confirmed'
                        }),
                        60000,
                        'Wallet approval'
                    );
                } else {
                    throw v0Error;
                }
            }
            console.log("[acceptTask] Transaction sent! Signature:", signature);

            setStatus("⏳ Confirming transaction on Devnet...");
            const confirmation = await withTimeout(
                pollSignatureConfirmation(connection, signature, "confirmed", 60000, publicKey),
                60000,
                "Transaction confirmation"
            );
            if (confirmation.status === "timeout" || confirmation.status === "expired") {
                throw new Error(confirmation.reason);
            }
            console.log(`[acceptTask] Transaction ${confirmation.status}:`, confirmation.signature);

            setIsTaskAccepted(true);
            setStatus("📡 Teleoperation Active: Awaiting vehicle confirmation...");
        } catch (error) {
            console.error("[acceptTask] Error:", error);
            const msg = error instanceof Error ? error.message : String(error);
            setStatus(`❌ Failed: ${msg.slice(0, 120)}`);
        }
    };

    const resolveTask = async () => {
        if (!publicKey || !wallet || !connected || sessionId === null) {
            setStatus("⚠️ Wallet not connected.");
            return;
        }
        setStatus("🔨 Preparing claim transaction...");

        try {
            const sessionPda = deriveSessionPda(sessionId);
            console.log("[resolveTask] Derived session PDA:", sessionPda.toBase58());
            const program = getProgram();

            const telemetryHash = new Uint8Array(32);
            window.crypto.getRandomValues(telemetryHash);

            setStatus("🔨 Building resolution instruction...");
            // Using Array.from bypasses browser Buffer polyfill serialization hazards
            const resolveTaskIx = await withTimeout<TransactionInstruction>(
                (program.methods as any)
                    .resolveTask(Array.from(telemetryHash))
                    .accounts({
                        operator: publicKey,
                        session: sessionPda,
                    })
                    .instruction(),
                10000,
                'Building resolveTask instruction'
            );

            setStatus("🌐 Fetching latest blockhash...");
            const latestBlockhash = await withTimeout(
                connection.getLatestBlockhash('confirmed'),
                15000,
                'Fetching latest blockhash'
            );

            setStatus("📝 Assembling claim transaction...");
            let signature: string;
            try {
                const messageV0 = new TransactionMessage({
                    payerKey: publicKey,
                    recentBlockhash: latestBlockhash.blockhash,
                    instructions: [
                        ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
                        resolveTaskIx,
                    ],
                }).compileToV0Message();

                const transaction = new VersionedTransaction(messageV0);

                // Simulate locally with sigVerify: false before sending.
                const debugSim = await withTimeout(
                    connection.simulateTransaction(transaction, {
                        commitment: 'confirmed',
                        sigVerify: false,
                    }),
                    10000,
                    'Local simulation'
                );
                if (debugSim.value.err) {
                    console.error("[resolveTask] Local simulation FAILED:",
                        JSON.stringify(debugSim.value.err, null, 2));
                } else {
                    console.log("[resolveTask] Local simulation OK.",
                        debugSim.value.returnData
                            ? `return data: ${JSON.stringify(debugSim.value.returnData)}`
                            : 'no return data');
                }

                console.log("[resolveTask] Instruction programId:", resolveTaskIx.programId.toBase58());
                console.log("[resolveTask] Instruction accounts:", resolveTaskIx.keys.map(k =>
                    `${k.pubkey.toBase58()}: ${k.isSigner ? 'signer' : 'readonly'}/${k.isWritable ? 'writable' : 'readonly'}`
                ).join(', '));
                console.log("[resolveTask] Instruction data (hex):", Buffer.from(resolveTaskIx.data).toString('hex'));

                setStatus("🔐 Check your wallet extension — approve claim...");
                signature = await withTimeout(
                    sendTransaction(transaction, connection, {
                        skipPreflight: true,
                        preflightCommitment: 'confirmed'
                    }),
                    60000,
                    'Wallet approval'
                );
            } catch (v0Error: any) {
                console.warn("[resolveTask] VersionedTransaction failed, attempting legacy Transaction fallback:", v0Error);
                if (v0Error?.message?.includes("version") || v0Error?.name === "WalletSendTransactionError") {
                    const legacyTx = new Transaction().add(resolveTaskIx);
                    legacyTx.recentBlockhash = latestBlockhash.blockhash;
                    legacyTx.feePayer = publicKey;
                    setStatus("🔐 Check your wallet extension — approve claim (legacy mode)...");
                    signature = await withTimeout(
                        sendTransaction(legacyTx, connection, {
                            skipPreflight: true,
                            preflightCommitment: 'confirmed'
                        }),
                        60000,
                        'Wallet approval'
                    );
                } else {
                    throw v0Error;
                }
            }

            setStatus("⏳ Confirming claim on Devnet...");

            const confirmation = await withTimeout(
                pollSignatureConfirmation(connection, signature, "confirmed", 60000, publicKey),
                60000,
                "Transaction confirmation"
            );

            if (confirmation.status === "timeout" || confirmation.status === "expired") {
                throw new Error(confirmation.reason);
            }

            setStatus("🎉 Bounty Claimed! Funds transferred.");
            setResolveSignature(signature);
            setShowReceiptModal(true);
            setIsTaskResolved(true);

            setTasksResolved(prev => prev + 1);
            setWeeklyData(prev => { const newData = [...prev]; newData[6] += 1; return newData; });
            setTotalEarnings(prev => prev + PROFILES[activeProfile].bountySol);
            setWeeklyEarnings(prev => { const newData = [...prev]; newData[6] += PROFILES[activeProfile].bountySol; return newData; });
        } catch (error) {
            console.error("[resolveTask] Error:", error);
            const msg = error instanceof Error ? error.message : String(error);
            setStatus(`❌ Claim failed: ${msg.slice(0, 120)}`);
        }
    };

    const returnToLobby = async () => {
        setIsTaskAccepted(false); setIsRobotReady(false); setIsTaskResolved(false);
        setIsTaskSlashed(false); setSlashSignature(null); setResolveSignature(null);
        setIsTaskCleared(false); setShowReceiptModal(false); setWorkState('lobby');
        await fetch('/api/robot', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ready: false, slashed: false, resolved: false, tx: null }) }).catch(e => console.error(e));
        await fetch('/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'idle' }) }).catch(e => console.error(e));
    };

    // ── Diagnostic: trivial self-transfer (hidden, ?debug=true only) ──
    const runDiagnosticTransfer = async () => {
        if (!publicKey || !wallet || !connected) {
            setDebugTxStatus('⛔ Wallet not connected.');
            return;
        }
        setDebugTxStatus('Building 0.001 SOL self-transfer...');
        try {
            const transferIx = SystemProgram.transfer({
                fromPubkey: publicKey,
                toPubkey: publicKey,
                lamports: 1_000_000, // 0.001 SOL
            });
            const latestBlockhash = await connection.getLatestBlockhash('confirmed');
            const messageV0 = new TransactionMessage({
                payerKey: publicKey,
                recentBlockhash: latestBlockhash.blockhash,
                instructions: [
                    ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
                    transferIx,
                ],
            }).compileToV0Message();
            const transaction = new VersionedTransaction(messageV0);
            console.log('[Diagnostic] Built self-transfer:', {
                from: publicKey.toBase58(),
                to: publicKey.toBase58(),
                lamports: 1_000_000,
                blockhash: latestBlockhash.blockhash.toString(),
            });
            setDebugTxStatus('Sending via sendTransaction (same as acceptTask)...');
            const sig = await sendTransaction(transaction, connection, {
                skipPreflight: true,
                preflightCommitment: 'confirmed',
            });
            setDebugTxSignature(sig);
            setDebugTxStatus(`Sent! Signature: ${sig.slice(0, 16)}...`);
            console.log('[Diagnostic] Signature:', sig);
        } catch (err) {
            setDebugTxStatus(`❌ Error: ${err instanceof Error ? err.message : String(err)}`);
            console.error('[Diagnostic] Error:', err);
        }
    };

    const LiveVideoFeed = ({ isLocked = false }: { isLocked?: boolean }) => (
        <div className="mb-8 bg-black rounded-xl overflow-hidden border border-slate-700 relative shadow-inner">
            {isLocked && (
                <div className="absolute inset-0 z-20 bg-slate-950/80 backdrop-blur-sm flex flex-col items-center justify-center border-2 border-red-500/50 rounded-xl animate-in fade-in duration-300">
                    <span className="text-5xl mb-4 animate-bounce">🔒</span>
                    <h3 className="text-xl font-bold text-red-400 mb-2 tracking-widest">TELEMETRY LOCKED</h3>
                    <p className="text-slate-300 text-sm max-w-sm text-center">
                        Liability unassigned. Sign the on-chain transaction to unlock WASD controls and assume command.
                    </p>
                </div>
            )}
            <div className="absolute top-0 left-0 w-full h-8 bg-gradient-to-b from-black/80 to-transparent z-10 flex justify-between items-center px-4 pointer-events-none">
                <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${rosConnected ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}`}></div>
                    <span className="text-xs font-mono text-slate-300">
                        {rosConnected ? 'WS_LINK: STABLE (9090)' : 'WS_LINK: DISCONNECTED'}
                    </span>
                </div>
                <div className="flex items-center gap-2">
                    <span className="text-xs font-mono text-red-500 font-bold border border-red-500/50 px-2 py-0.5 rounded bg-red-900/30">
                        ● LIVE FEED
                    </span>
                </div>
            </div>
            <div className="aspect-video relative w-full flex items-center justify-center bg-slate-900 cursor-crosshair">
                <img
                    src="http://127.0.0.1:8080/stream?topic=/camera/image_raw&quality=50&width=640&height=480"
                    alt="Robot Camera Feed"
                    className="w-full h-full object-cover opacity-90"
                    onError={(e) => {
                        e.currentTarget.style.display = 'none';
                        e.currentTarget.parentElement?.querySelector('#video-fallback')?.classList.replace('hidden', 'flex');
                    }}
                />
                <div id="video-fallback" className="absolute inset-0 hidden flex-col items-center justify-center bg-slate-900 border border-slate-800">
                    <span className="text-4xl mb-3 opacity-50">📷</span>
                    <p className="text-slate-400 font-medium">Awaiting Video Stream...</p>
                    <p className="text-slate-600 text-xs mt-1">Start ROS 2 web_video_server on port 8080</p>
                </div>
            </div>
            <div className="absolute bottom-4 left-0 w-full flex justify-center z-10 pointer-events-none">
                <div className="bg-black/60 backdrop-blur border border-slate-700/50 p-2 rounded-lg flex flex-col items-center gap-1 shadow-2xl">
                    <div className={`w-10 h-10 rounded border ${activeKeys['w'] ? 'bg-indigo-600 border-indigo-400 text-white' : 'bg-slate-800 border-slate-600 text-slate-400'} flex items-center justify-center font-bold transition-all`}>W</div>
                    <div className="flex gap-1">
                        <div className={`w-10 h-10 rounded border ${activeKeys['a'] ? 'bg-indigo-600 border-indigo-400 text-white' : 'bg-slate-800 border-slate-600 text-slate-400'} flex items-center justify-center font-bold transition-all`}>A</div>
                        <div className={`w-10 h-10 rounded border ${activeKeys['s'] ? 'bg-indigo-600 border-indigo-400 text-white' : 'bg-slate-800 border-slate-600 text-slate-400'} flex items-center justify-center font-bold transition-all`}>S</div>
                        <div className={`w-10 h-10 rounded border ${activeKeys['d'] ? 'bg-indigo-600 border-indigo-400 text-white' : 'bg-slate-800 border-slate-600 text-slate-400'} flex items-center justify-center font-bold transition-all`}>D</div>
                    </div>
                </div>
            </div>
        </div>
    );

    if (!publicKey) {
        return (
            <main className="flex min-h-screen flex-col items-center justify-center bg-slate-950 font-mono p-4 relative overflow-hidden">
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-emerald-900/20 rounded-full blur-[100px] pointer-events-none"></div>
                {isLocalhost && (
                    <div className="absolute top-0 left-0 right-0 z-20 bg-amber-900/30 border-b border-amber-700/50 px-4 py-2 text-center">
                        <p className="text-sm text-amber-300">
                            ⚠️ Local dev mode — wallet extensions may show security warnings for
                            <code className="bg-amber-900/50 px-1 rounded ml-1">localhost</code>.
                            Click through to proceed.
                        </p>
                    </div>
                )}
                <div className="z-10 text-center max-w-lg">
                    <div className="mb-8 inline-block p-4 rounded-2xl bg-slate-900 border border-slate-800 shadow-2xl">
                        <h1 className="text-4xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-blue-500 mb-2">Fallback Protocol</h1>
                        <p className="text-slate-400">Decentralized Teleoperation Network</p>
                    </div>
                    <div className="bg-slate-900/80 backdrop-blur-md p-8 rounded-2xl border border-slate-800 shadow-xl mb-8">
                        <h2 className="text-xl font-semibold text-white mb-4">Operator Login</h2>
                        <p className="text-sm text-slate-400 mb-8">Connect your Solana wallet to access the fleet command center and start earning bounties.</p>
                        <div className="mb-6 p-3 rounded-lg bg-amber-900/30 border border-amber-800/50 text-xs text-amber-300">
                            <p className="font-medium mb-1">⚠️ Wallet Security Warning</p>
                            <p>Your wallet extension (Phantom/Solflare) may show a "site not recognized" or "unsafe" warning when you first connect or sign a transaction. This is normal for new domains.</p>
                            <p className="mt-1"><strong>To resolve:</strong> In Phantom, click "Approve" or "Trust" this site. In Solflare, click "Approve" or add the site to your trusted list. Once approved, the warning won't appear again.</p>
                        </div>
                        <div className="flex justify-center">
                            <WalletMultiButton style={{ backgroundColor: '#10b981', padding: '0 32px', height: '48px', fontSize: '16px' }} />
                        </div>
                    </div>
                    <div className="flex gap-4 justify-center text-xs text-slate-500">
                        <span>● Live on Devnet</span><span>● v1.0.0</span>
                    </div>
                </div>
            </main>
        );
    }

    const currentProfile = PROFILES[activeProfile];
    const maxChartVal = Math.max(...weeklyData, 5);
    const maxEarningsVal = Math.max(...weeklyEarnings, 2.0);
    const last7Days = Array.from({ length: 7 }).map((_, i) => {
        const d = new Date(); d.setDate(d.getDate() - (6 - i));
        return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(d);
    });

    return (
        <main className="flex min-h-screen bg-slate-950 font-mono">
            <aside className="w-64 border-r border-slate-800 bg-slate-900/50 flex flex-col hidden md:flex">
                {/* ── Hidden diagnostic button (top-right corner of sidebar, ?debug=true only) ── */}
                {isDebugMode && (
                    <div className="absolute top-4 right-4 z-10">
                        <div className="bg-slate-900 border border-red-700/50 rounded-lg p-2 shadow-lg animate-in fade-in duration-300">
                            <div className="text-center">
                                <p className="text-[10px] font-bold text-red-400 uppercase tracking-wider mb-1">Diagnostic</p>
                                <button
                                    onClick={runDiagnosticTransfer}
                                    disabled={!publicKey || !connected}
                                    className="w-full text-[11px] py-1.5 bg-red-900/40 hover:bg-red-800/60 text-red-200 font-semibold rounded disabled:opacity-40 disabled:cursor-not-allowed transition-all border border-red-700/30"
                                >
                                    🧪 Self-Transfer 0.001 SOL
                                </button>
                                {debugTxStatus && (
                                    <p className="text-[10px] text-slate-400 mt-1 truncate">{debugTxStatus}</p>
                                )}
                                {debugTxSignature && (
                                    <a href={`https://explorer.solana.com/tx/${debugTxSignature}?cluster=devnet`}
                                       target="_blank" rel="noopener noreferrer"
                                       className="text-[10px] text-blue-400 hover:underline truncate block mt-0.5">
                                        {debugTxSignature.slice(0, 16)}...
                                    </a>
                                )}
                            </div>
                        </div>
                    </div>
                )}
                <div className="p-6 border-b border-slate-800">
                    <h1 className="font-bold text-emerald-400 text-xl tracking-tight">Fallback</h1>
                    <p className="text-xs text-slate-500 mt-1">Operator Console</p>
                </div>
                <nav className="flex-1 p-4 flex flex-col gap-2">
                    <button onClick={() => setCurrentTab('work')} className={`text-left px-4 py-3 rounded-lg font-medium transition-all ${currentTab === 'work' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}>🎯 Find Work</button>
                    <button onClick={() => setCurrentTab('earnings')} className={`text-left px-4 py-3 rounded-lg font-medium transition-all ${currentTab === 'earnings' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}>💰 Earnings</button>
                    <button onClick={() => setCurrentTab('training')} className={`text-left px-4 py-3 rounded-lg font-medium transition-all ${currentTab === 'training' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}>🎓 Training Hub</button>
                </nav>
                <div className="p-4 border-t border-slate-800 flex flex-col gap-2">
                    <button onClick={() => setShowWalletDetails(!showWalletDetails)} className="w-full py-2.5 px-4 flex items-center justify-between bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg transition-all">
                        <div className="flex items-center gap-2">
                            {wallet?.adapter.icon && <img src={wallet.adapter.icon} alt="Wallet Icon" className="w-5 h-5 rounded-sm" />}
                            <span className="text-slate-200 text-sm font-medium">{publicKey.toBase58().slice(0, 4)}...{publicKey.toBase58().slice(-4)}</span>
                        </div>
                        <span className="text-slate-400 text-xs">{showWalletDetails ? '▲' : '▼'}</span>
                    </button>
                    {showWalletDetails && (
                        <div className="bg-slate-900 border border-slate-700 rounded-lg p-3 flex flex-col gap-3 shadow-xl animate-in fade-in slide-in-from-top-2 duration-200">
                            <div><p className="text-xs text-slate-500 mb-1">Connected Wallet</p><p className="text-sm text-emerald-400 font-bold">{wallet?.adapter.name || 'Unknown'}</p></div>
                            <div><p className="text-xs text-slate-500 mb-1">Full Address</p><p className="text-xs text-slate-400 break-all font-mono bg-slate-950 p-2 rounded border border-slate-800 select-all">{publicKey.toBase58()}</p></div>
                            <button onClick={() => setShowDisconnectConfirm(true)} className="w-full py-2 mt-1 bg-slate-950 hover:bg-red-900/30 border border-slate-800 text-slate-400 hover:text-red-400 rounded-md transition-all text-sm font-medium">Disconnect Wallet</button>
                        </div>
                    )}
                </div>
            </aside>

            <section className="flex-1 flex flex-col h-screen overflow-y-auto">
                <header className="md:hidden p-4 border-b border-slate-800 bg-slate-900 flex justify-between items-center">
                    <h1 className="font-bold text-emerald-400">Fallback</h1>
                    <div className="flex gap-2 items-center">
                        <button onClick={() => setCurrentTab('work')} className={`px-2 py-1 text-xs rounded ${currentTab==='work'?'bg-indigo-600':'bg-slate-800'}`}>Work</button>
                        <button onClick={() => setCurrentTab('earnings')} className={`px-2 py-1 text-xs rounded ${currentTab==='earnings'?'bg-indigo-600':'bg-slate-800'}`}>Earn</button>
                        <button onClick={() => setShowDisconnectConfirm(true)} className="px-2 py-1 text-xs rounded bg-slate-800 text-red-400 ml-1 border border-slate-700">Exit</button>
                    </div>
                </header>

                <div className="p-6 md:p-12 max-w-4xl w-full mx-auto pb-24">

                    {currentTab === 'earnings' && (
                        <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                            <h2 className="text-3xl font-bold text-white mb-2">Earnings Dashboard</h2>
                            <p className="text-slate-400 mb-8">Track your teleoperation bounties and SLA performance.</p>

                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
                                <div className="bg-slate-900 p-6 rounded-xl border border-slate-800">
                                    <p className="text-sm text-slate-400 mb-1">Session Earnings</p>
                                    <p className="text-3xl font-bold text-emerald-400">{totalEarnings.toFixed(2)} SOL</p>
                                </div>
                                <div className="bg-slate-900 p-6 rounded-xl border border-slate-800">
                                    <p className="text-sm text-slate-400 mb-1">Tasks Resolved</p>
                                    <p className="text-3xl font-bold text-white">{tasksResolved}</p>
                                </div>
                                <div className="bg-slate-900 p-6 rounded-xl border border-slate-800">
                                    <p className="text-sm text-slate-400 mb-1">Success Rate (SLA)</p>
                                    <p className="text-3xl font-bold text-blue-400">{tasksResolved > 0 ? '100%' : '0%'}</p>
                                </div>
                            </div>

                            <div className="flex flex-col gap-6">
                                <div className="bg-slate-900 p-6 rounded-xl border border-slate-800 h-64 flex flex-col justify-end gap-2 relative">
                                    <p className="absolute top-6 left-6 text-slate-400 text-sm">Task Volume (Last 7 Days)</p>
                                    {tasksResolved === 0 && <div className="absolute inset-0 flex items-center justify-center pointer-events-none"><p className="text-slate-600 text-sm">No tasks completed yet. Go online to start earning!</p></div>}
                                    <div className="flex items-end justify-between h-40 gap-2 mt-10">
                                        {weeklyData.map((taskCount, i) => {
                                            const barHeight = tasksResolved === 0 ? 0 : (taskCount / maxChartVal) * 100;
                                            return (
                                                <div key={i} className="w-full bg-emerald-500/20 hover:bg-emerald-500/40 border border-emerald-500/30 rounded-t-sm transition-all duration-1000 ease-out flex flex-col justify-end items-center" style={{ height: `${barHeight}%`, minHeight: barHeight > 0 ? '20px' : '0px' }}>
                                                    {taskCount > 0 && <span className="text-emerald-400 text-xs font-bold mb-1">{taskCount}</span>}
                                                </div>
                                            )
                                        })}
                                    </div>
                                    <div className="flex justify-between text-xs text-slate-500 mt-2 px-2">
                                        {last7Days.map((dateStr, idx) => (
                                            <span key={idx} className={idx === 6 ? "text-emerald-400 font-bold bg-emerald-900/30 px-2 py-0.5 rounded border border-emerald-500/20" : ""}>
                                                {idx === 6 ? `Today (${dateStr})` : dateStr}
                                            </span>
                                        ))}
                                    </div>
                                </div>

                                <div className="bg-slate-900 p-6 rounded-xl border border-slate-800 h-64 flex flex-col justify-end gap-2 relative">
                                    <p className="absolute top-6 left-6 text-slate-400 text-sm">Earnings Output (SOL)</p>
                                    {totalEarnings === 0 && <div className="absolute inset-0 flex items-center justify-center pointer-events-none"><p className="text-slate-600 text-sm">No earnings recorded yet.</p></div>}
                                    <div className="flex items-end justify-between h-40 gap-2 mt-10">
                                        {weeklyEarnings.map((earnAmt, i) => {
                                            const barHeight = totalEarnings === 0 ? 0 : (earnAmt / maxEarningsVal) * 100;
                                            return (
                                                <div key={i} className="w-full bg-blue-500/20 hover:bg-blue-500/40 border border-blue-500/30 rounded-t-sm transition-all duration-1000 ease-out flex flex-col justify-end items-center" style={{ height: `${barHeight}%`, minHeight: barHeight > 0 ? '20px' : '0px' }}>
                                                    {earnAmt > 0 && <span className="text-blue-400 text-[10px] sm:text-xs font-bold mb-1 text-center leading-tight">{earnAmt.toFixed(1)}</span>}
                                                </div>
                                            )
                                        })}
                                    </div>
                                    <div className="flex justify-between text-xs text-slate-500 mt-2 px-2">
                                        {last7Days.map((dateStr, idx) => (
                                            <span key={idx} className={idx === 6 ? "text-blue-400 font-bold bg-blue-900/30 px-2 py-0.5 rounded border border-blue-500/20" : ""}>
                                                {idx === 6 ? `Today (${dateStr})` : dateStr}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {currentTab === 'training' && (
                        <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                            {!isTrainingMode ? (
                                <>
                                    <h2 className="text-3xl font-bold text-white mb-2">Training Hub</h2>
                                    <p className="text-slate-400 mb-8">Test your connection and practice teleoperation in a simulated environment.</p>

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div className="bg-slate-900 p-6 rounded-xl border border-emerald-500/50 shadow-[0_0_15px_rgba(16,185,129,0.1)] relative overflow-hidden transition-all hover:border-emerald-400 group">
                                            <div className="absolute top-2 right-2 bg-emerald-500/20 text-emerald-400 text-xs px-2 py-1 rounded font-bold">Simulator Active</div>
                                            <h3 className="font-bold text-white text-lg mb-2">Class 1: Sandbox Simulator</h3>
                                            <p className="text-sm text-slate-400 mb-6">Test WS_LINK connection and practice WASD maneuvering in the local Gazebo physics engine.</p>
                                            <button
                                                onClick={() => setIsTrainingMode(true)}
                                                className="px-4 py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-lg text-sm w-full transition-all shadow-lg group-hover:scale-[1.02]"
                                            >
                                                Enter Simulator ↗
                                            </button>
                                        </div>

                                        <div className="bg-slate-900 p-6 rounded-xl border border-slate-700 relative overflow-hidden">
                                            <div className="absolute top-2 right-2 bg-slate-800 text-slate-400 text-xs px-2 py-1 rounded">Locked</div>
                                            <h3 className="font-bold text-slate-300 text-lg mb-2">Class 2: Robotaxi / Street</h3>
                                            <p className="text-sm text-slate-500 mb-4">High-stakes traffic negotiation and emergency override procedures.</p>
                                            <button disabled className="px-4 py-2 bg-slate-800/50 text-slate-500 rounded text-sm w-full cursor-not-allowed">Requires 10 Tasks</button>
                                        </div>
                                    </div>
                                </>
                            ) : (
                                <div className="animate-in zoom-in-95 duration-300">
                                    <div className="flex justify-between items-center mb-6">
                                        <div>
                                            <h2 className="text-2xl font-bold text-white flex items-center gap-2">
                                                <span className="text-emerald-400 animate-pulse">●</span> Active Sandbox Simulation
                                            </h2>
                                            <p className="text-slate-400 text-sm">Testing direct WebSocket pipeline to localhost:9090</p>
                                        </div>
                                        <button
                                            onClick={() => setIsTrainingMode(false)}
                                            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg transition-all text-sm font-medium border border-slate-600"
                                        >
                                            Exit Simulator
                                        </button>
                                    </div>

                                    <LiveVideoFeed isLocked={false} />

                                    <div className="bg-slate-900 p-5 rounded-xl border border-slate-800">
                                        <h4 className="font-bold text-white mb-2">Training Checklist:</h4>
                                        <ul className="text-sm text-slate-400 space-y-2">
                                            <li className="flex items-center gap-2">
                                                <div className={`w-4 h-4 rounded-full ${rosConnected ? 'bg-emerald-500' : 'bg-slate-700'}`}></div>
                                                Establish ROSBridge Connection (Port 9090)
                                            </li>
                                            <li className="flex items-center gap-2">
                                                <div className={`w-4 h-4 rounded-full ${(activeKeys['w'] || activeKeys['a'] || activeKeys['s'] || activeKeys['d']) ? 'bg-emerald-500' : 'bg-slate-700'}`}></div>
                                                Send `geometry_msgs/Twist` commands
                                            </li>
                                        </ul>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {currentTab === 'work' && (
                        <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                            {workState === 'lobby' && (
                                <>
                                    <h2 className="text-3xl font-bold text-white mb-2">Select Target Vehicle</h2>
                                    <p className="text-slate-400 mb-8">Choose which fleet segment you want to monitor for incidents.</p>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
                                        <button onClick={() => setActiveProfile('delivery')} className={`text-left p-6 rounded-xl border transition-all ${activeProfile === 'delivery' ? 'bg-slate-800 border-emerald-500 ring-1 ring-emerald-500 shadow-[0_0_15px_rgba(16,185,129,0.1)]' : 'bg-slate-900 border-slate-800 hover:border-slate-600'}`}>
                                            <h3 className="font-bold text-white text-lg mb-1">Delivery Robots</h3>
                                            <p className="text-sm text-slate-400 mb-4">Low stakes, high volume.</p>
                                            <div className="flex justify-between items-center text-xs"><span className="text-emerald-400 bg-emerald-500/10 px-2 py-1 rounded">~0.1 SOL Bounty</span><span className="text-slate-500">Req: 0.05 SOL Stake</span></div>
                                        </button>
                                        <button onClick={() => setActiveProfile('robotaxi')} className={`text-left p-6 rounded-xl border transition-all ${activeProfile === 'robotaxi' ? 'bg-slate-800 border-amber-500 ring-1 ring-amber-500 shadow-[0_0_15px_rgba(245,158,11,0.1)]' : 'bg-slate-900 border-slate-800 hover:border-slate-600'}`}>
                                            <h3 className="font-bold text-white text-lg mb-1">Robotaxis</h3>
                                            <p className="text-sm text-slate-400 mb-4">High stakes, complex environments.</p>
                                            <div className="flex justify-between items-center text-xs"><span className="text-amber-400 bg-amber-500/10 px-2 py-1 rounded">~1.0 SOL Bounty</span><span className="text-slate-500">Req: 0.5 SOL Stake</span></div>
                                        </button>
                                    </div>
                                    <button onClick={() => setWorkState('searching')} className="w-full py-4 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-xl shadow-[0_0_20px_rgba(79,70,229,0.3)] transition-all text-lg">Go Online & Find Work</button>
                                </>
                            )}

                            {workState === 'searching' && (
                                <div className="flex flex-col items-center justify-center py-20 text-center animate-in zoom-in-95 duration-500">
                                    <div className="relative w-32 h-32 mb-8">
                                        <div className="absolute inset-0 border-4 border-indigo-500/20 rounded-full"></div>
                                        <div className="absolute inset-0 border-4 border-t-indigo-500 rounded-full animate-spin"></div>
                                        <div className="absolute inset-4 bg-indigo-500/10 rounded-full animate-pulse"></div>
                                        <div className="absolute inset-0 flex items-center justify-center text-3xl">📡</div>
                                    </div>
                                    <h2 className="text-2xl font-bold text-white mb-2">Scanning Network...</h2>
                                    <p className="text-slate-400 mb-8 max-w-md">Listening for unhandled exceptions...</p>
                                    <button onClick={() => setWorkState('lobby')} className="px-6 py-2 bg-slate-800 text-slate-400 rounded-lg hover:bg-slate-700 transition-all">Cancel Search</button>
                                </div>
                            )}

                            {workState === 'active' && (
                                <div className={`border ${currentProfile.boxBorder} ${currentProfile.boxBg} p-6 md:p-8 rounded-2xl shadow-2xl relative overflow-hidden animate-in slide-in-from-right-8 duration-500`}>
                                    <div className={`absolute top-0 left-0 w-1.5 h-full ${currentProfile.accent}`}></div>

                                    <div className="flex justify-between items-start mb-6">
                                        <div>
                                            <span className={`${currentProfile.tagColor} px-3 py-1 rounded-full text-xs font-bold border uppercase tracking-wider mb-3 inline-block animate-pulse`}>Deadlock Detected</span>
                                            <h2 className="text-2xl font-bold text-white flex items-center gap-2">{currentProfile.id}</h2>
                                            <p className="text-sm text-slate-400 mt-1">Session: {sessionId} | {currentProfile.location}</p>
                                        </div>
                                        <div className="text-right flex flex-col items-end gap-2 bg-slate-950/50 p-3 rounded-lg border border-slate-800">
                                            <div><p className="text-xs text-slate-500 uppercase tracking-wider">Bounty</p><p className="text-2xl font-bold text-emerald-400">{currentProfile.bountySol} SOL</p></div>
                                            <div className="w-full h-px bg-slate-800 my-1"></div>
                                            <div><p className="text-xs text-slate-500 uppercase tracking-wider">Bond Req.</p><p className="text-sm font-bold text-blue-400">{currentProfile.stakeSol} SOL</p></div>
                                        </div>
                                    </div>

                                    {!isTaskResolved && !isTaskSlashed && (
                                        <LiveVideoFeed isLocked={!isTaskAccepted} />
                                    )}

                                    {isTaskSlashed && (
                                        <div className="mb-8 p-5 bg-red-950/80 border border-red-500 rounded-xl text-red-200 animate-in fade-in zoom-in-95 duration-300">
                                            <p className="font-bold flex items-center gap-2 text-lg text-red-400 mb-2">
                                                🚨 SLAUGHTER PROTOCOL EXECUTED
                                            </p>
                                            <p className="mb-4 text-sm">
                                                The operational window expired. The vehicle executed <code className="bg-red-900/60 px-1.5 py-0.5 rounded text-red-300">cancel_timeout</code>,
                                                reclaimed its bounty, and <strong>slashed your {currentProfile.stakeSol} SOL stake</strong>.
                                            </p>
                                            {slashSignature && (
                                                <a href={`https://explorer.solana.com/tx/${slashSignature}?cluster=devnet`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 px-4 py-2 bg-red-900/60 hover:bg-red-800 text-red-100 border border-red-500/50 rounded-lg text-sm font-bold transition-all shadow-lg">
                                                    View Slash Proof (Explorer) ↗
                                                </a>
                                            )}
                                        </div>
                                    )}

                                    <div className="flex flex-col md:flex-row items-center justify-between pt-6 border-t border-slate-800/80 gap-4">
                                        <p className="text-sm font-medium text-slate-400 w-full md:w-1/2">{status}</p>
                                        <div className="w-full md:w-1/2 flex justify-end gap-3">
                                            {isTaskSlashed ? (
                                                <button onClick={returnToLobby} className="px-6 py-3 bg-slate-800 hover:bg-slate-700 text-white font-bold rounded-lg shadow-lg transition-all border border-slate-600">Return to Lobby ⟳</button>
                                            ) : !isTaskAccepted ? (
                                                <button onClick={acceptTask} className="px-8 py-3 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-lg shadow-[0_0_15px_rgba(79,70,229,0.4)] transition-all animate-pulse hover:animate-none">Stake {currentProfile.stakeSol} SOL & Accept</button>
                                            ) : !isRobotReady ? (
                                                <button disabled className="px-8 py-3 bg-slate-800 text-slate-400 font-bold rounded-lg cursor-not-allowed flex items-center justify-center gap-3 border border-slate-700"><span className="animate-spin text-xl">⏳</span> Awaiting Vehicle...</button>
                                            ) : !isTaskCleared ? (
                                                <button disabled className="px-8 py-3 bg-indigo-900/40 text-indigo-400 font-bold rounded-lg cursor-not-allowed flex items-center justify-center gap-3 border border-indigo-700/50"><span className="animate-spin text-xl">⚙️</span> Teleoperation Active...</button>
                                            ) : !isTaskResolved ? (
                                                <button onClick={resolveTask} className="px-8 py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-lg shadow-[0_0_15px_rgba(16,185,129,0.4)] transition-all border border-emerald-400">Claim {currentProfile.bountySol} SOL</button>
                                            ) : (
                                                <button onClick={() => setShowReceiptModal(true)} className="px-6 py-3 bg-slate-800 hover:bg-slate-700 text-white font-bold rounded-lg transition-all border border-slate-600">View Receipt</button>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </section>

            {/* RECEIPT MODAL */}
            {showReceiptModal && resolveSignature && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm px-4 animate-in fade-in duration-300">
                    <div className="bg-slate-900 border border-slate-700 p-8 rounded-2xl shadow-2xl max-w-sm w-full relative animate-in zoom-in-95 duration-300">
                        <button onClick={returnToLobby} className="absolute top-4 right-4 text-slate-500 hover:text-white transition-colors">✕</button>
                        <div className="text-center mb-6">
                            <div className="w-16 h-16 bg-emerald-500/20 text-emerald-400 rounded-full flex items-center justify-center mx-auto mb-4 border border-emerald-500/30">
                                <span className="text-2xl">✓</span>
                            </div>
                            <h3 className="text-2xl font-bold text-white">Bounty Claimed</h3>
                            <p className="text-slate-400 text-sm mt-1">Funds transferred to operator</p>
                        </div>
                        <div className="space-y-3 mb-8 bg-slate-950 p-5 rounded-xl border border-slate-800">
                            <div className="flex justify-between items-center text-sm">
                                <span className="text-slate-400">Stake Refunded</span>
                                <span className="text-blue-400 font-mono">+ {currentProfile.stakeSol} SOL</span>
                            </div>
                            <div className="flex justify-between items-center text-sm">
                                <span className="text-slate-400">Bounty Reward</span>
                                <span className="text-emerald-400 font-mono">+ {currentProfile.bountySol} SOL</span>
                            </div>
                            <div className="w-full h-px bg-slate-800 my-3"></div>
                            <div className="flex justify-between items-center font-bold text-lg">
                                <span className="text-white">Total Payout</span>
                                <span className="text-emerald-400 font-mono">{(currentProfile.bountySol + currentProfile.stakeSol).toFixed(2)} SOL</span>
                            </div>
                        </div>
                        <div className="flex flex-col gap-3">
                            <a href={`https://explorer.solana.com/tx/${resolveSignature}?cluster=devnet`} target="_blank" rel="noopener noreferrer" className="w-full text-center px-4 py-3 bg-slate-800 hover:bg-slate-700 text-white font-medium rounded-xl transition-all border border-slate-700">View on Solana Explorer</a>
                            <button onClick={returnToLobby} className="w-full text-center px-4 py-3 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-xl transition-all shadow-lg">
                                Return to Lobby
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* DISCONNECT CONFIRMATION MODAL */}
            {showDisconnectConfirm && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-sm px-4 animate-in fade-in duration-200">
                    <div className="bg-slate-900 border border-slate-700 p-6 rounded-2xl shadow-2xl max-w-sm w-full relative animate-in zoom-in-95 duration-200">
                        <h3 className="text-xl font-bold text-white mb-2">Disconnect Wallet?</h3>
                        <p className="text-slate-400 text-sm mb-6">You will need to reconnect to accept new tasks and claim bounties.</p>
                        <div className="flex gap-3">
                            <button onClick={() => setShowDisconnectConfirm(false)} className="flex-1 py-2.5 bg-slate-800 hover:bg-slate-700 text-white font-medium rounded-lg transition-all border border-slate-700">Cancel</button>
                            <button onClick={() => { disconnect(); setShowDisconnectConfirm(false); }} className="flex-1 py-2.5 bg-red-600 hover:bg-red-500 text-white font-bold rounded-lg transition-all">Disconnect</button>
                        </div>
                    </div>
                </div>
            )}
        </main>
    );
}
