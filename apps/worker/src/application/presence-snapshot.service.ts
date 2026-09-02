import type { UsersRepository } from "@ghs/api/data/users.repository";
import type { PresenceSnapshotsRepository } from "@ghs/api/data/presence-snapshots.repository";

export interface PresenceSnapshotDeps {
  users: UsersRepository;
  presenceSnapshots: PresenceSnapshotsRepository;
}

// ghs#195: every 15 minutes (poll-loop.ts's own lastPresenceSnapshotAt/
// presenceSnapshotIntervalMs gate, same pattern as runRetentionCleanup),
// record one aggregate row for the Admin Dashboard's Active Right Now
// sparkline -- the exact same countActiveNow() the dashboard's own live
// KPI already calls, just persisted here instead of thrown away, so the
// sparkline and the bare "active right now" number can never disagree
// about what "active" means. No per-run logging (unlike retention
// cleanup, this always does real work, never a no-op worth calling out --
// a failure still surfaces via poll-loop.ts's own outer catch).
export async function runPresenceSnapshot(deps: PresenceSnapshotDeps): Promise<void> {
  const { users, presenceSnapshots } = deps;
  const activeCount = await users.countActiveNow();
  await presenceSnapshots.insertSnapshot(activeCount);
}
