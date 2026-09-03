import { test } from "node:test";
import assert from "node:assert/strict";
import { createDashboardService } from "../src/application/dashboard.service.ts";
import type { HandicapHistoryService } from "../src/application/handicap-history.service.ts";
import type { RoundsService } from "../src/application/rounds.service.ts";
import type { Logger } from "../src/logger.ts";
import type { HandicapHistoryRecord } from "../src/data/handicap-history.repository.ts";
import type { CourseRoundRanking, PlayerRoundListItem, PlayerRoundRanking, PlayerStats } from "../src/data/rounds.repository.ts";
import type { CourseCountryBreakdown, CoursesRepository } from "../src/data/courses.repository.ts";
import type { RegistrationTrendPoint, UserRoleBreakdown, UsersRepository } from "../src/data/users.repository.ts";
import type { PresenceSnapshotSeriesPoint, PresenceSnapshotsRepository } from "../src/data/presence-snapshots.repository.ts";
import type { SystemSettingsService } from "../src/application/system-settings.service.ts";

// Pure unit tests (ENG-030.3) -- no HTTP, no real database. Proves the
// per-section failure isolation this issue's own acceptance criteria
// calls out as the genuinely new, worth-getting-right part of this
// endpoint (design doc section L.2): one section's rejected promise
// must never take the other sections down with it.

const SAMPLE_HISTORY: HandicapHistoryRecord[] = [
  {
    id: "h1", playerId: "player-1", method: "calculated", handicapIndex: 14.2, previousIndex: 15.0,
    reason: null, createdBy: null, calculationSnapshot: null, calculationDate: "2026-05-01", createdAt: "2026-05-01",
  },
];

const SAMPLE_ROUNDS: PlayerRoundListItem[] = [
  { id: "r1", playerId: "player-1", courseId: "c1", courseName: "Sunningdale", teeConfigurationId: "t1", teeConfigurationName: "White", playedAt: "2026-05-01T09:00:00.000Z", status: "approved" },
];

const SAMPLE_STATS: PlayerStats = {
  roundsCount: 1, coursesCount: 1, holesCount: 18, girPercentage: 50, fairwayHitPercentage: 60,
  fairwayMissedLeftPercentage: 20, fairwayMissedRightPercentage: 20, puttsPerRound: 32, puttsHolesCount: 18,
  onePuttHoles: 3, threePlusPuttHoles: 1, penaltiesPerRound: 1, sandInteractionPercentage: 10,
};

const SAMPLE_ROLE_BREAKDOWN: UserRoleBreakdown = { total: 10, player: 7, admin: 2, superAdmin: 1 };
// ghs#197: total !== the sum of just the top-2 countries -- `others`
// (12) is real, distinct data a test can assert on, not just derivable
// from the other two fields.
const SAMPLE_COURSE_BREAKDOWN: CourseCountryBreakdown = {
  total: 47,
  topCountries: [
    { country: "US", count: 20 },
    { country: "GB", count: 15 },
  ],
  others: 12,
};
const SAMPLE_TOP_COURSES: CourseRoundRanking[] = [{ courseId: "c1", courseName: "Sunningdale", roundsCount: 42 }];
const SAMPLE_MOST_ACTIVE_PLAYERS: PlayerRoundRanking[] = [
  { playerId: "p1", playerFirstName: "Alice", playerLastName: "Whitfield", roundsCount: 24, handicapIndex: 12.4 },
];
const SAMPLE_USER_TRENDS: RegistrationTrendPoint[] = [{ date: "2026-05-01", count: 3 }];
const SAMPLE_ACTIVE_RIGHT_NOW = 5;
const SAMPLE_ACTIVE_USERS_SERIES: PresenceSnapshotSeriesPoint[] = [{ timestamp: "2026-09-01T00:00:00.000Z", count: 4 }];
// ghs#195: the section's own real shape -- countActiveNow's live number,
// plus whatever the (fake) presence-snapshots repository and (fake)
// system-settings service produce. The fake below returns the same
// series for both the current and previous window (there's no
// meaningful "which call is which" distinction worth faking here), and
// defaults the configured period to "24h".
const SAMPLE_ACTIVE_RIGHT_NOW_SNAPSHOT = {
  current: SAMPLE_ACTIVE_RIGHT_NOW,
  period: "24h" as const,
  series: SAMPLE_ACTIVE_USERS_SERIES,
  previousSeries: SAMPLE_ACTIVE_USERS_SERIES,
  hasHistory: true,
};

// Records every error() call rather than writing to stdout -- review
// finding, PR #183: toSection previously discarded a section's error
// entirely, so a real failure became a silent 200 with no trace
// anywhere. These tests assert the logger actually captured it.
function fakeLogger(): Logger & { errors: Array<{ message: string; fields?: Record<string, unknown> }> } {
  const errors: Array<{ message: string; fields?: Record<string, unknown> }> = [];
  return {
    errors,
    debug() {},
    info() {},
    warn() {},
    error(message, fields) {
      errors.push({ message, fields });
    },
  };
}

function fakeHandicapHistoryService(overrides: Partial<HandicapHistoryService> = {}): HandicapHistoryService {
  return {
    async getCurrentIndex() {
      throw new Error("not used by these tests");
    },
    async getCurrentIndexForUpdate() {
      throw new Error("not used by these tests");
    },
    async listHistoryForPlayer() {
      return SAMPLE_HISTORY;
    },
    async recordCalculatedResult() {
      throw new Error("not used by these tests");
    },
    async recordManualOverride() {
      throw new Error("not used by these tests");
    },
    ...overrides,
  };
}

// Total/pending counts distinguished by whether the caller filtered on
// status='pending' -- getAdminDashboard's own totalRounds section makes
// exactly these two real listAdminRounds calls (limit: 1, only the
// COUNT(*) it already computes matters), so the fake mirrors that
// real shape rather than returning one flat number for both.
const SAMPLE_ROUNDS_TOTAL = 20;
const SAMPLE_ROUNDS_PENDING = 3;
// ghs#199: eighteenHole + nineHole sums to SAMPLE_ROUNDS_TOTAL, matching
// the real invariant getHoleCountBreakdown's own comment documents.
const SAMPLE_ROUNDS_EIGHTEEN_HOLE = 15;
const SAMPLE_ROUNDS_NINE_HOLE = 5;

function fakeRoundsService(overrides: Partial<RoundsService> = {}): RoundsService {
  const notUsed = async () => {
    throw new Error("not used by these tests");
  };
  return {
    createRound: notUsed,
    addHoleScore: notUsed,
    updateScores: notUsed,
    getRound: notUsed,
    async listRoundsForPlayer() {
      return SAMPLE_ROUNDS;
    },
    listPendingQueue: notUsed,
    async listAdminRounds(filter) {
      return { items: [], total: filter.status === "pending" ? SAMPLE_ROUNDS_PENDING : SAMPLE_ROUNDS_TOTAL };
    },
    async getHoleCountBreakdown() {
      return { total: SAMPLE_ROUNDS_TOTAL, eighteenHole: SAMPLE_ROUNDS_EIGHTEEN_HOLE, nineHole: SAMPLE_ROUNDS_NINE_HOLE };
    },
    async getPlayerStats() {
      return SAMPLE_STATS;
    },
    async getTopCourses() {
      return SAMPLE_TOP_COURSES;
    },
    async getMostActivePlayers() {
      return SAMPLE_MOST_ACTIVE_PLAYERS;
    },
    submitForReview: notUsed,
    approveRound: notUsed,
    rejectRound: notUsed,
    deleteRound: notUsed,
    reopenForAmendment: notUsed,
    updatePlayedAt: notUsed,
    ...overrides,
  } as RoundsService;
}

function fakeUsersRepository(overrides: Partial<UsersRepository> = {}): UsersRepository {
  const notUsed = async () => {
    throw new Error("not used by these tests");
  };
  return {
    create: notUsed,
    findByEmail: notUsed,
    findById: notUsed,
    markEmailVerified: notUsed,
    setStatus: notUsed,
    setPasswordHash: notUsed,
    list: notUsed,
    updateLastActiveAt: notUsed,
    async countActiveNow() {
      return SAMPLE_ACTIVE_RIGHT_NOW;
    },
    async getRoleBreakdown() {
      return SAMPLE_ROLE_BREAKDOWN;
    },
    async getRegistrationTrend() {
      return SAMPLE_USER_TRENDS;
    },
    ...overrides,
  } as UsersRepository;
}

function fakePresenceSnapshotsRepository(overrides: Partial<PresenceSnapshotsRepository> = {}): PresenceSnapshotsRepository {
  return {
    async insertSnapshot() {
      throw new Error("not used by these tests -- only apps/worker calls this");
    },
    async getSeries() {
      return SAMPLE_ACTIVE_USERS_SERIES;
    },
    async hasAnySnapshot() {
      return true;
    },
    ...overrides,
  };
}

function fakeSystemSettingsService(overrides: Partial<SystemSettingsService> = {}): SystemSettingsService {
  const notUsed = async () => {
    throw new Error("not used by these tests");
  };
  return {
    getMaintenanceMode: notUsed,
    setMaintenanceMode: notUsed,
    getSelfRegistrationEnabled: notUsed,
    setSelfRegistrationEnabled: notUsed,
    getNotificationSettings: notUsed,
    setNotificationSetting: notUsed,
    getNotificationPollIntervalSeconds: notUsed,
    setNotificationPollIntervalSeconds: notUsed,
    async getActiveUsersChartPeriod() {
      return "24h";
    },
    setActiveUsersChartPeriod: notUsed,
    ...overrides,
  } as SystemSettingsService;
}

function fakeCoursesRepository(overrides: Partial<CoursesRepository> = {}): CoursesRepository {
  const notUsed = async () => {
    throw new Error("not used by these tests");
  };
  return {
    list: notUsed,
    async getCountryBreakdown() {
      return SAMPLE_COURSE_BREAKDOWN;
    },
    create: notUsed,
    get: notUsed,
    getTeeConfiguration: notUsed,
    update: notUsed,
    delete: notUsed,
    createTeeConfiguration: notUsed,
    updateTeeConfiguration: notUsed,
    deleteTeeConfiguration: notUsed,
    ...overrides,
  } as CoursesRepository;
}

test("getPlayerDashboard returns real data for every section when all three underlying calls succeed", async () => {
  const logger = fakeLogger();
  const service = createDashboardService(fakeHandicapHistoryService(), fakeRoundsService(), fakeUsersRepository(), fakeCoursesRepository(), fakePresenceSnapshotsRepository(), fakeSystemSettingsService(), logger);

  const dashboard = await service.getPlayerDashboard("player-1");

  assert.deepEqual(dashboard.handicapHistory, { data: SAMPLE_HISTORY });
  assert.deepEqual(dashboard.recentRounds, { data: SAMPLE_ROUNDS });
  assert.deepEqual(dashboard.stats, { data: SAMPLE_STATS });
  assert.equal(logger.errors.length, 0, "nothing failed -- nothing should be logged");
});

test("one section's rejected promise becomes { error: true } without affecting the other two sections (per-section failure isolation, ghs#176)", async () => {
  const logger = fakeLogger();
  const service = createDashboardService(
    fakeHandicapHistoryService({
      async listHistoryForPlayer() {
        throw new Error("handicap_history table temporarily unavailable");
      },
    }),
    fakeRoundsService(),
    fakeUsersRepository(),
    fakeCoursesRepository(),
    fakePresenceSnapshotsRepository(),
    fakeSystemSettingsService(),
    logger,
  );

  const dashboard = await service.getPlayerDashboard("player-1");

  assert.deepEqual(dashboard.handicapHistory, { error: true });
  // The other two sections are untouched real data, not swept into the
  // same failure -- the entire point of this pattern over a single
  // try/catch around the whole aggregation.
  assert.deepEqual(dashboard.recentRounds, { data: SAMPLE_ROUNDS });
  assert.deepEqual(dashboard.stats, { data: SAMPLE_STATS });

  // Review finding, PR #183: the failure must be logged, not just
  // swallowed into a silent 200 -- verified here, not just assumed from
  // the source reading correctly.
  assert.equal(logger.errors.length, 1);
  assert.equal(logger.errors[0]!.message, "dashboard section failed");
  assert.equal(logger.errors[0]!.fields?.section, "handicapHistory");
  assert.equal(logger.errors[0]!.fields?.playerId, "player-1");
  assert.match(String(logger.errors[0]!.fields?.error), /handicap_history table temporarily unavailable/);
});

test("a second section can independently fail while a third stays real data", async () => {
  const logger = fakeLogger();
  const service = createDashboardService(
    fakeHandicapHistoryService(),
    fakeRoundsService({
      async listRoundsForPlayer() {
        throw new Error("rounds query timed out");
      },
    }),
    fakeUsersRepository(),
    fakeCoursesRepository(),
    fakePresenceSnapshotsRepository(),
    fakeSystemSettingsService(),
    logger,
  );

  const dashboard = await service.getPlayerDashboard("player-1");

  assert.deepEqual(dashboard.handicapHistory, { data: SAMPLE_HISTORY });
  assert.deepEqual(dashboard.recentRounds, { error: true });
  assert.deepEqual(dashboard.stats, { data: SAMPLE_STATS });
  assert.equal(logger.errors.length, 1);
  assert.equal(logger.errors[0]!.fields?.section, "recentRounds");
});

test("every section can fail independently at once -- still resolves (not a rejected promise/blanket 500), just three error markers, each logged", async () => {
  const logger = fakeLogger();
  const service = createDashboardService(
    fakeHandicapHistoryService({
      async listHistoryForPlayer() {
        throw new Error("boom 1");
      },
    }),
    fakeRoundsService({
      async listRoundsForPlayer() {
        throw new Error("boom 2");
      },
      async getPlayerStats() {
        throw new Error("boom 3");
      },
    }),
    fakeUsersRepository(),
    fakeCoursesRepository(),
    fakePresenceSnapshotsRepository(),
    fakeSystemSettingsService(),
    logger,
  );

  const dashboard = await service.getPlayerDashboard("player-1");

  assert.deepEqual(dashboard.handicapHistory, { error: true });
  assert.deepEqual(dashboard.recentRounds, { error: true });
  assert.deepEqual(dashboard.stats, { error: true });
  assert.equal(logger.errors.length, 3);
  assert.deepEqual(logger.errors.map((e) => e.fields?.section).sort(), ["handicapHistory", "recentRounds", "stats"]);
});

test("getAdminDashboard (ghs#180): returns real data for every section when all underlying calls succeed", async () => {
  const logger = fakeLogger();
  const service = createDashboardService(fakeHandicapHistoryService(), fakeRoundsService(), fakeUsersRepository(), fakeCoursesRepository(), fakePresenceSnapshotsRepository(), fakeSystemSettingsService(), logger);

  const dashboard = await service.getAdminDashboard(30);

  assert.deepEqual(dashboard.totalUsers, { data: SAMPLE_ROLE_BREAKDOWN });
  assert.deepEqual(dashboard.totalCourses, { data: SAMPLE_COURSE_BREAKDOWN });
  assert.deepEqual(dashboard.totalRounds, { data: { total: SAMPLE_ROUNDS_TOTAL, pending: SAMPLE_ROUNDS_PENDING, eighteenHole: SAMPLE_ROUNDS_EIGHTEEN_HOLE, nineHole: SAMPLE_ROUNDS_NINE_HOLE } });
  assert.deepEqual(dashboard.topCourses, { data: SAMPLE_TOP_COURSES });
  assert.deepEqual(dashboard.mostActivePlayers, { data: SAMPLE_MOST_ACTIVE_PLAYERS });
  assert.deepEqual(dashboard.activeRightNow, { data: SAMPLE_ACTIVE_RIGHT_NOW_SNAPSHOT });
  assert.deepEqual(dashboard.userTrends, { data: SAMPLE_USER_TRENDS });
  assert.equal(logger.errors.length, 0, "nothing failed -- nothing should be logged");
});

test("ghs#195: activeRightNow reports hasHistory=false when the worker hasn't recorded a single snapshot yet -- the cold-start signal the frontend uses to show a 'collecting history' state instead of a flatlined-at-zero chart", async () => {
  const logger = fakeLogger();
  const service = createDashboardService(
    fakeHandicapHistoryService(),
    fakeRoundsService(),
    fakeUsersRepository(),
    fakeCoursesRepository(),
    fakePresenceSnapshotsRepository({ async hasAnySnapshot() { return false; } }),
    fakeSystemSettingsService(),
    logger,
  );

  const dashboard = await service.getAdminDashboard(30);

  assert.deepEqual(dashboard.activeRightNow, {
    data: { ...SAMPLE_ACTIVE_RIGHT_NOW_SNAPSHOT, hasHistory: false },
  });
});

test("ghs#195 (review finding, PR #196): the series' range boundaries are aligned to a fixed 15-minute grid, not to raw request-time `now` -- date_bin's own origin (getSeries' rangeStart) must be stable across requests, or the exact same stored snapshot could land in a visibly different bucket on the next dashboard poll", async () => {
  const calls: Array<{ rangeStart: Date; rangeEnd: Date }> = [];
  const presenceSnapshots = fakePresenceSnapshotsRepository({
    async getSeries(rangeStart, rangeEnd) {
      calls.push({ rangeStart, rangeEnd });
      return SAMPLE_ACTIVE_USERS_SERIES;
    },
  });
  const service = createDashboardService(
    fakeHandicapHistoryService(),
    fakeRoundsService(),
    fakeUsersRepository(),
    fakeCoursesRepository(),
    presenceSnapshots,
    fakeSystemSettingsService(),
    fakeLogger(),
  );

  const before = Date.now();
  await service.getAdminDashboard(30);
  const after = Date.now();

  assert.equal(calls.length, 2, "one getSeries call for the current series, one for the previous series");
  const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;
  const [currentCall, previousCall] = calls;

  // The current series' own rangeEnd (the sparkline's "now" boundary) is
  // aligned to the fixed 15-minute grid -- exactly divisible by the
  // bucket width from the Unix epoch, not merely "close to now".
  assert.equal(currentCall!.rangeEnd.getTime() % FIFTEEN_MINUTES_MS, 0);
  // It's the last COMPLETED bucket boundary: at or before the real
  // request time (never a future boundary), and no more than one full
  // bucket width in the past.
  assert.ok(currentCall!.rangeEnd.getTime() <= after);
  assert.ok(currentCall!.rangeEnd.getTime() > before - FIFTEEN_MINUTES_MS);

  // Previous series picks up exactly where the current series' own
  // window starts -- no gap, no overlap.
  assert.equal(previousCall!.rangeEnd.getTime(), currentCall!.rangeStart.getTime());
});

test("getAdminDashboard: a failed totalUsers section (and, independently, the activeRightNow section that shares the same repository) doesn't affect any other section (per-section failure isolation, ghs#180)", async () => {
  const logger = fakeLogger();
  const service = createDashboardService(
    fakeHandicapHistoryService(),
    fakeRoundsService(),
    fakeUsersRepository({
      async getRoleBreakdown() {
        throw new Error("users table temporarily unavailable");
      },
    }),
    fakeCoursesRepository(),
    fakePresenceSnapshotsRepository(),
    fakeSystemSettingsService(),
    logger,
  );

  const dashboard = await service.getAdminDashboard(30);

  assert.deepEqual(dashboard.totalUsers, { error: true });
  // Every other section, including activeRightNow (a different method on
  // the SAME users repository), is untouched real data -- proves the
  // isolation is per-call, not per-dependency.
  assert.deepEqual(dashboard.totalCourses, { data: SAMPLE_COURSE_BREAKDOWN });
  assert.deepEqual(dashboard.totalRounds, { data: { total: SAMPLE_ROUNDS_TOTAL, pending: SAMPLE_ROUNDS_PENDING, eighteenHole: SAMPLE_ROUNDS_EIGHTEEN_HOLE, nineHole: SAMPLE_ROUNDS_NINE_HOLE } });
  assert.deepEqual(dashboard.topCourses, { data: SAMPLE_TOP_COURSES });
  assert.deepEqual(dashboard.mostActivePlayers, { data: SAMPLE_MOST_ACTIVE_PLAYERS });
  assert.deepEqual(dashboard.activeRightNow, { data: SAMPLE_ACTIVE_RIGHT_NOW_SNAPSHOT });
  assert.deepEqual(dashboard.userTrends, { data: SAMPLE_USER_TRENDS });
  assert.equal(logger.errors.length, 1);
  assert.equal(logger.errors[0]!.fields?.section, "totalUsers");
});

test("getAdminDashboard: totalRounds fails as one unit when either of its two underlying listAdminRounds calls rejects", async () => {
  const logger = fakeLogger();
  const service = createDashboardService(
    fakeHandicapHistoryService(),
    fakeRoundsService({
      async listAdminRounds(filter) {
        if (filter.status === "pending") throw new Error("pending count query failed");
        return { items: [], total: SAMPLE_ROUNDS_TOTAL };
      },
    }),
    fakeUsersRepository(),
    fakeCoursesRepository(),
    fakePresenceSnapshotsRepository(),
    fakeSystemSettingsService(),
    logger,
  );

  const dashboard = await service.getAdminDashboard(30);

  assert.deepEqual(dashboard.totalRounds, { error: true });
  assert.deepEqual(dashboard.totalUsers, { data: SAMPLE_ROLE_BREAKDOWN }, "unrelated sections stay real data");
  assert.equal(logger.errors.length, 1);
  assert.equal(logger.errors[0]!.fields?.section, "totalRounds");
});

test("ghs#199: getAdminDashboard: totalRounds also fails as one unit when getHoleCountBreakdown rejects, even though both listAdminRounds calls succeed", async () => {
  const logger = fakeLogger();
  const service = createDashboardService(
    fakeHandicapHistoryService(),
    fakeRoundsService({
      async getHoleCountBreakdown() {
        throw new Error("hole count query failed");
      },
    }),
    fakeUsersRepository(),
    fakeCoursesRepository(),
    fakePresenceSnapshotsRepository(),
    fakeSystemSettingsService(),
    logger,
  );

  const dashboard = await service.getAdminDashboard(30);

  assert.deepEqual(dashboard.totalRounds, { error: true });
  assert.deepEqual(dashboard.totalUsers, { data: SAMPLE_ROLE_BREAKDOWN }, "unrelated sections stay real data");
  assert.equal(logger.errors.length, 1);
  assert.equal(logger.errors[0]!.fields?.section, "totalRounds");
});

test("getAdminDashboard: userTrends passes the caller's own days parameter straight through, and logs it on failure", async () => {
  const logger = fakeLogger();
  let receivedDays: number | undefined;
  const service = createDashboardService(
    fakeHandicapHistoryService(),
    fakeRoundsService(),
    fakeUsersRepository({
      async getRegistrationTrend(days) {
        receivedDays = days;
        throw new Error("registrations query failed");
      },
    }),
    fakeCoursesRepository(),
    fakePresenceSnapshotsRepository(),
    fakeSystemSettingsService(),
    logger,
  );

  const dashboard = await service.getAdminDashboard(90);

  assert.equal(receivedDays, 90);
  assert.deepEqual(dashboard.userTrends, { error: true });
  assert.equal(logger.errors[0]!.fields?.section, "userTrends");
  assert.equal(logger.errors[0]!.fields?.days, 90);
});

test("getAdminDashboard: every section can fail independently at once -- still resolves, one error marker per section", async () => {
  const logger = fakeLogger();
  const service = createDashboardService(
    fakeHandicapHistoryService(),
    fakeRoundsService({
      async listAdminRounds() {
        throw new Error("rounds boom");
      },
      async getTopCourses() {
        throw new Error("top courses boom");
      },
      async getMostActivePlayers() {
        throw new Error("most active players boom");
      },
    }),
    fakeUsersRepository({
      async getRoleBreakdown() {
        throw new Error("role breakdown boom");
      },
      async countActiveNow() {
        throw new Error("active right now boom");
      },
      async getRegistrationTrend() {
        throw new Error("user trends boom");
      },
    }),
    fakeCoursesRepository({
      async getCountryBreakdown() {
        throw new Error("courses boom");
      },
    }),
    fakePresenceSnapshotsRepository(),
    fakeSystemSettingsService(),
    logger,
  );

  const dashboard = await service.getAdminDashboard(30);

  assert.deepEqual(dashboard.totalUsers, { error: true });
  assert.deepEqual(dashboard.totalCourses, { error: true });
  assert.deepEqual(dashboard.totalRounds, { error: true });
  assert.deepEqual(dashboard.topCourses, { error: true });
  assert.deepEqual(dashboard.mostActivePlayers, { error: true });
  assert.deepEqual(dashboard.activeRightNow, { error: true });
  assert.deepEqual(dashboard.userTrends, { error: true });
  assert.equal(logger.errors.length, 7);
});
