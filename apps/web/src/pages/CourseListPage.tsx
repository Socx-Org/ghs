import { Plus } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { Alert, Button, Card, CardBody, EmptyState, ListView, Skeleton, TableCell, TableHeaderCell } from "../components";
import { ApiError, listCourses } from "../lib/api";
import { useAuth } from "../hooks/useAuth";
import type { CourseSummary } from "../types/domain";

// ghs#109: course list screen -- design doc section 6.1. First real
// consumer of ListView (#103) outside Accounts. No role restriction on
// viewing (matches GET /courses, unauthenticated on the backend) -- the
// nav entry and route are open to every authenticated role. Sort order
// itself is still whatever GET /courses returns (name-ordered) --
// narrowing the result client-side, via ListView's own search (ghs#137),
// is a separate concern from sort order and doesn't change it. No
// column filters here -- name/location are free text, not the
// enum-like data ListView's column-filter opt-in is meant for.
//
// ghs#110: rows now link to /courses/:id, and a "Create course" button
// is shown for admin/super_admin -- the only real action this list
// gains from that issue (edit/delete themselves live on the detail
// screen, not here).

function locationLine(item: CourseSummary): string | null {
  if (item.city && item.country) return `${item.city}, ${item.country}`;
  return item.city ?? item.country ?? null;
}

function describeQueryError(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

export default function CourseListPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin" || user?.role === "super_admin";
  const coursesQuery = useQuery({ queryKey: ["courses"], queryFn: listCourses });

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="mt-4 text-2xl font-semibold text-text">Courses</h1>
          <p className="mt-2 text-sm text-text-muted">Golf courses available for round entry.</p>
        </div>
        {isAdmin && (
          <Button icon={<Plus aria-hidden="true" className="h-4 w-4" />} onClick={() => navigate("/courses/new")}>
            Create course
          </Button>
        )}
      </div>

      <Card className="mt-8">
        <CardBody>
          {coursesQuery.isPending ? (
            <div className="flex flex-col gap-2">
              <Skeleton height={40} />
              <Skeleton height={40} />
              <Skeleton height={40} />
            </div>
          ) : coursesQuery.isError ? (
            <Alert variant="error">{describeQueryError(coursesQuery.error, "Couldn't load courses. Try refreshing the page.")}</Alert>
          ) : (
            <ListView<CourseSummary>
              id="courses"
              items={coursesQuery.data}
              getKey={(item) => item.id}
              searchPlaceholder="Search by name, city, or country…"
              getSearchText={(item) => `${item.name} ${item.city ?? ""} ${item.country ?? ""}`}
              tableHead={
                <>
                  <TableHeaderCell>Name</TableHeaderCell>
                  <TableHeaderCell>Location</TableHeaderCell>
                </>
              }
              renderTableRow={(item) => (
                <>
                  <TableCell>
                    <Link to={`/courses/${item.id}`} className="font-medium text-primary hover:underline">
                      {item.name}
                    </Link>
                  </TableCell>
                  <TableCell>{locationLine(item) ?? "—"}</TableCell>
                </>
              )}
              renderCard={(item) => (
                <Card>
                  <CardBody className="flex flex-col gap-1">
                    <Link to={`/courses/${item.id}`} className="text-sm font-medium text-primary hover:underline">
                      {item.name}
                    </Link>
                    <p className="text-xs text-text-muted">{locationLine(item) ?? "—"}</p>
                  </CardBody>
                </Card>
              )}
              emptyState={<EmptyState title="No courses yet" description="Courses added by an administrator will show up here." />}
            />
          )}
        </CardBody>
      </Card>
    </div>
  );
}
