'use client';

import { FC, ReactNode, useMemo } from 'react';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import '@solana/wallet-adapter-react-ui/styles.css';

// Prefer NEXT_PUBLIC_SOLANA_RPC (Alchemy/Helius) if set, fallback to dedicated Alchemy Devnet RPC
const DEVNET_RPC =
    process.env.NEXT_PUBLIC_SOLANA_RPC ||
    'https://solana-devnet.g.alchemy.com/v2/alch_18IfjxfhzdbYvYEbUivwJ';

export const WalletContextProvider: FC<{ children: ReactNode }> = ({ children }) => {
    const endpoint = useMemo(() => DEVNET_RPC, []);

    const wallets = useMemo(
        () => [],
        []
    );

    return (
        <ConnectionProvider endpoint={endpoint} config={{ commitment: 'confirmed' }}>
            <WalletProvider wallets={wallets} autoConnect>
                <WalletModalProvider>{children}</WalletModalProvider>
            </WalletProvider>
        </ConnectionProvider>
    );
};
