use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};

declare_id!("H8FYdjnCybk2vzbAKKKUbCiQQrohEjAwCXCo11gETnqT");

#[program]
pub mod fallback_protocol {
    use super::*;

    // 1. Robot requests help and escrows the bounty
    pub fn request_fallback(ctx: Context<RequestFallback>, session_id: u64, bounty: u64) -> Result<()> {
        let session = &mut ctx.accounts.session;
        session.session_id = session_id;
        session.robot = ctx.accounts.robot.key();
        session.operator = Pubkey::default();
        session.bounty = bounty;
        session.operator_bond = 0;
        session.status = 0; // 0 = Open
        
        let clock = Clock::get()?;
        session.created_at = clock.unix_timestamp;
        session.telemetry_hash = [0; 32];
        session.timeout_at = clock.unix_timestamp + 3600; // 1 hour to find an operator

        // CPI (Cross-Program Invocation) to transfer the bounty lamports from the robot's wallet to the Session PDA
        let cpi_context = CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            Transfer {
                from: ctx.accounts.robot.to_account_info(),
                to: session.to_account_info(),
            },
        );
        transfer(cpi_context, bounty)?;

        Ok(())
    }

    // 2. Operator stakes their security bond to claim the task
    pub fn accept_task(ctx: Context<AcceptTask>, operator_bond: u64) -> Result<()> {
        let session = &mut ctx.accounts.session;
        
        // Ensure the session is actually available
        require!(session.status == 0, ErrorCode::SessionNotOpen);
        
        let clock = Clock::get()?;
        require!(clock.unix_timestamp < session.timeout_at, ErrorCode::SessionExpired);
        session.operator = ctx.accounts.operator.key();
        session.operator_bond = operator_bond;
        session.status = 1; // 1 = Active
        session.timeout_at = clock.unix_timestamp + 20;

        // CPI to transfer the operator's bond lamports into the Session PDA
        let cpi_context = CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            Transfer {
                from: ctx.accounts.operator.to_account_info(),
                to: session.to_account_info(),
            },
        );
        transfer(cpi_context, operator_bond)?;

        Ok(())
    }

    // 3. Operator resolves the edge case, unlocking bounty + bond
    pub fn resolve_task(ctx: Context<ResolveTask>, telemetry_hash: [u8; 32]) -> Result<()> {
        let session = &mut ctx.accounts.session;
        
        require!(session.status == 1, ErrorCode::SessionNotActive);
        require!(session.operator == ctx.accounts.operator.key(), ErrorCode::UnauthorizedOperator);

        session.telemetry_hash = telemetry_hash;
        session.status = 2; // 2 = Resolved

        let total_payout = session.bounty + session.operator_bond;

        // Idiomatic Solana payout: directly modify lamport balances to move SOL out of a PDA
        **session.to_account_info().try_borrow_mut_lamports()? -= total_payout;
        **ctx.accounts.operator.to_account_info().try_borrow_mut_lamports()? += total_payout;

        Ok(())
    }

    // 4. Robot cancels the session if the operator times out, slashing the bond
    pub fn cancel_timeout(ctx: Context<CancelTimeout>) -> Result<()> {
    let session = &mut ctx.accounts.session;
    
    // Ensure the session is currently claimed by an operator
    require!(session.status == 1, ErrorCode::SessionNotActive);
    
    let clock = Clock::get()?;
    require!(clock.unix_timestamp >= session.timeout_at, ErrorCode::TimeoutNotReached);

    session.status = 3; // 3 = Slashed

    // The robot reclaims its original bounty PLUS the operator's slashed bond
    let total_refund = session.bounty + session.operator_bond;

    **session.to_account_info().try_borrow_mut_lamports()? -= total_refund;
    **ctx.accounts.robot.to_account_info().try_borrow_mut_lamports()? += total_refund;

    Ok(())
    }
}

// --- ACCOUNT VALIDATION STRUCTS ---

#[derive(Accounts)]
#[instruction(session_id: u64)]
pub struct RequestFallback<'info> {
    #[account(mut)]
    pub robot: Signer<'info>,
    
    // Derive the PDA based on the word "session", the robot's public key, and the session ID.
    #[account(
        init,
        payer = robot,
        space = 8 + Session::INIT_SPACE,
        seeds = [b"session", robot.key().as_ref(), session_id.to_le_bytes().as_ref()],
        bump
    )]
    pub session: Account<'info, Session>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AcceptTask<'info> {
    #[account(mut)]
    pub operator: Signer<'info>,
    
    #[account(mut)]
    pub session: Account<'info, Session>,
    
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ResolveTask<'info> {
    #[account(mut)]
    pub operator: Signer<'info>,
    
    #[account(mut)]
    pub session: Account<'info, Session>,
}

#[derive(Accounts)]
pub struct CancelTimeout<'info> {
    #[account(mut)]
    pub robot: Signer<'info>,
    
    // The has_one constraint guarantees this session actually belongs to this robot
    #[account(mut, has_one = robot)]
    pub session: Account<'info, Session>,
}

// --- DATA SCHEMAS & ERRORS ---

#[account]
#[derive(InitSpace)]
pub struct Session {
    pub session_id: u64,          // 8 bytes: Unique ID for this incident
    pub robot: Pubkey,            // 32 bytes: Public key of the stranded AMR
    pub operator: Pubkey,         // 32 bytes: Public key of the remote operator
    pub bounty: u64,              // 8 bytes: Reward locked by the robot (lamports)
    pub operator_bond: u64,       // 8 bytes: Security stake locked by operator
    pub status: u8,               // 1 byte: 0=Open, 1=Active, 2=Resolved, 3=Slashed
    pub created_at: i64,          // 8 bytes: Timestamp created
    pub timeout_at: i64,          // 8 bytes: Timestamp expiration
    pub telemetry_hash: [u8; 32], // 32 bytes: SHA-256 hash of clearance
}

#[error_code]
pub enum ErrorCode {
    #[msg("This session is no longer open for operators.")]
    SessionNotOpen,
    #[msg("This session is not currently active.")]
    SessionNotActive,
    #[msg("This session has expired.")]
    SessionExpired,
    #[msg("You are not the authorized operator for this session.")]
    UnauthorizedOperator,
    #[msg("The timeout period has not yet been reached.")]
    TimeoutNotReached,
}
