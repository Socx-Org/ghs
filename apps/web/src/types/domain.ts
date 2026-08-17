// Mirrors the backend's own types exactly (apps/api/src/data/rounds.repository.ts
// RoundStatus, apps/api/src/data/users.repository.ts UserRole) -- kept here
// as the minimal frontend vocabulary needed for domain-aware components
// (RoundStatusBadge, RoleBadge) until #63 introduces the real API client
// and shared types. If these ever drift from the backend, that's a bug to
// fix, not an intentional frontend-only variation.
export type RoundStatus = "draft" | "pending" | "approved" | "rejected" | "amending";

export type UserRole = "player" | "admin" | "super_admin";
