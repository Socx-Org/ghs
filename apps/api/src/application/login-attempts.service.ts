import type { LoginAttemptsRepository, ListLoginAttemptsPage } from "../data/login-attempts.repository.ts";

// ghs#231 review fix: this service only ever wraps list() -- the admin
// route's one real consumer. Writing a login_attempts row happens
// entirely inside auth.service.ts (via the injected LoginAttemptsRepository
// directly, same "repository injected into another service, not wrapped"
// convention as that file's own `notifications: NotificationsRepository`
// dependency), since auth.service.ts is where every real branch deciding
// WHAT to record already lives -- a `record()` method here would just be
// dead code no caller ever reaches, which is exactly what the previous
// version of this file was (it also claimed, via its own logger.info
// call, to log every attempt -- a promise that silently never came true).
export interface LoginAttemptsService {
  list(limit: number, offset: number): Promise<ListLoginAttemptsPage>;
}

export function createLoginAttemptsService(repository: LoginAttemptsRepository): LoginAttemptsService {
  return {
    async list(limit, offset) {
      return repository.list(limit, offset);
    },
  };
}
