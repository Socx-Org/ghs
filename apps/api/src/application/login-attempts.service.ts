import type { Logger } from "../logger.ts";
import type { LoginAttemptsRepository, ListLoginAttemptsPage, RecordLoginAttemptInput } from "../data/login-attempts.repository.ts";

export interface LoginAttemptsService {
  record(input: RecordLoginAttemptInput): Promise<void>;
  list(limit: number, offset: number): Promise<ListLoginAttemptsPage>;
}

export function createLoginAttemptsService(repository: LoginAttemptsRepository, logger: Logger): LoginAttemptsService {
  return {
    async record(input) {
      await repository.record(input);
      logger.info("login attempt recorded", { outcome: input.outcome, userId: input.userId });
    },

    async list(limit, offset) {
      return repository.list(limit, offset);
    },
  };
}
