import { useQuery } from "@tanstack/react-query";
import { Alert, Card, CardBody, EmptyState, ListView, Skeleton, TableCell, TableHeaderCell } from "../components";
import { ApiError, listCourses } from "../lib/api";
import type { CourseSummary } from "../types/domain";

// ghs#109: course list screen -- design doc section 6.1. First real
// consumer of ListView (#103) outside Accounts. No role restriction on
// viewing (matches GET /courses, unauthenticated on the backend) -- the
// nav entry and route are open to every authenticated role. No actions
// column and no filtering/sorting beyond what GET /courses supports
// today (name-ordered only) -- both explicit non-scope; edit/delete are
// separate issues (#110/#111), not assumed here.

function locationLine(item: CourseSummary): string | null {
  if (item.city && item.country) return `${item.city}, ${item.country}`;
  return item.city ?? item.country ?? null;
}

function describeQueryError(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

export default function CourseListPage() {
  const coursesQuery = useQuery({ queryKey: ["courses"], queryFn: listCourses });

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <div>
        <h1 className="mt-4 text-2xl font-semibold text-text">Courses</h1>
        <p className="mt-2 text-sm text-text-muted">Golf courses available for round entry.</p>
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
              tableHead={
                <>
                  <TableHeaderCell>Name</TableHeaderCell>
                  <TableHeaderCell>Location</TableHeaderCell>
                </>
              }
              renderTableRow={(item) => (
                <>
                  <TableCell>{item.name}</TableCell>
                  <TableCell>{locationLine(item) ?? "—"}</TableCell>
                </>
              )}
              renderCard={(item) => (
                <Card>
                  <CardBody className="flex flex-col gap-1">
                    <p className="text-sm font-medium text-text">{item.name}</p>
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
