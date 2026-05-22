CREATE DOMAIN IF NOT EXISTS DURABLE_CALL_KIND AS text
	NOT NULL
	CONSTRAINT durable_call_kind_allowed CHECK (value IN ('fn', 'fx', 'tx'));
--> statement-breakpoint

CREATE DOMAIN IF NOT EXISTS DURABLE_CALL_STATUS AS text
	DEFAULT 'queued'
	NOT NULL
	CONSTRAINT durable_call_status_allowed CHECK (value IN ('queued', 'claimed', 'running', 'succeeded', 'failed', 'cancelled'));
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `durable_calls` (
	`id` TEXT PRIMARY KEY NOT NULL,
	`actor_inbox_id` TEXT NOT NULL REFERENCES `actor_inbox`(`id`) ON UPDATE no action ON DELETE cascade,
	-- `effect_index` is the position in the host-computed flattened effect list:
	--   [...current_state.exit, ...transition.actions, ...target_state.entry]
	-- It is used instead of function name as the durable call identity because the same
	-- guest function can legally appear multiple times, including across exit/action/entry.
	-- Store `function_name` too so reconciliation can detect manifest/version drift.
	`effect_index` INTEGER NOT NULL CHECK (`effect_index` >= 0),
	`idempotency_key` TEXT NOT NULL,
	`function_kind` DURABLE_CALL_KIND,
	`function_name` TEXT NOT NULL,
	`input` JSON DEFAULT 'null' NOT NULL,
	`status` DURABLE_CALL_STATUS,
	`result` JSON,
	`error` JSON,
	`claimed_by_worker_id` TEXT,
	-- Lease is worker ownership, not the max job runtime.
	-- Long-running calls should heartbeat periodically to push `lease_expires_at` forward.
	-- Another worker may reclaim only when status is claimed/running and `lease_expires_at` is in the past.
	-- `run_timeout_at` is the optional hard runtime deadline for sandbox execution.
	`lease_expires_at` TIMESTAMP,
	`last_heartbeat_at` TIMESTAMP,
	`run_timeout_at` TIMESTAMP,
	`attempt` INTEGER DEFAULT 0 NOT NULL CHECK (`attempt` >= 0),
	`created_at` TIMESTAMP DEFAULT (datetime('now')) NOT NULL,
	`started_at` TIMESTAMP,
	`completed_at` TIMESTAMP,
	`updated_at` TIMESTAMP DEFAULT (datetime('now')) NOT NULL,
	UNIQUE (`actor_inbox_id`, `effect_index`),
	UNIQUE (`idempotency_key`)
) STRICT;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS `durable_calls_queue_idx` ON `durable_calls` (`status`, `created_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `durable_calls_inbox_idx` ON `durable_calls` (`actor_inbox_id`, `effect_index`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `durable_calls_lease_idx` ON `durable_calls` (`status`, `lease_expires_at`);
--> statement-breakpoint

CREATE TRIGGER IF NOT EXISTS `durable_calls_updated_at_after_update`
AFTER UPDATE ON `durable_calls`
FOR EACH ROW
WHEN NEW.`updated_at` = OLD.`updated_at`
BEGIN
	UPDATE `durable_calls`
	SET `updated_at` = datetime('now')
	WHERE `id` = OLD.`id`;
END;
