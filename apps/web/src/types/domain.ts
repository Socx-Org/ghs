// Mirrors the backend's own types exactly (apps/api/src/data/rounds.repository.ts
// RoundStatus, apps/api/src/data/users.repository.ts UserRole) -- the
// canonical source for both, not superseded by #63's API client/auth
// layer (lib/api.ts, lib/auth-store.ts). UserRole is imported from here
// into AuthUser rather than a second copy living alongside the JWT
// claims that populate it. If these ever drift from the backend, that's
// a bug to fix, not an intentional frontend-only variation.
export type RoundStatus = "draft" | "pending" | "approved" | "rejected" | "amending";

export type UserRole = "player" | "admin" | "super_admin";
