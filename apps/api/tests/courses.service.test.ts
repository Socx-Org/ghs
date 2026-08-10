import { test } from "node:test";
import assert from "node:assert/strict";
import { createCoursesService } from "../src/application/courses.service.ts";
import { createLogger } from "../src/logger.ts";
import type { Course, CoursesRepository, CreateCourseInput } from "../src/data/courses.repository.ts";

function fakeRepository(initial: Course[] = []): CoursesRepository {
  const courses = [...initial];
  return {
    async list() {
      return courses.map(({ id, clubId, name, city, country }) => ({ id, clubId, name, city, country }));
    },
    async create(input: CreateCourseInput) {
      const course: Course = {
        id: String(courses.length + 1),
        clubId: input.clubId ?? null,
        name: input.name,
        city: input.city ?? null,
        country: input.country ?? null,
        teeConfigurations: (input.teeConfigurations ?? []).map((tee, i) => ({
          id: `tee-${i + 1}`,
          name: tee.name,
          holeCount: tee.holeCount,
          courseRating: tee.courseRating,
          slopeRating: tee.slopeRating,
          holes: tee.holes.map((h, j) => ({ id: `hole-${j + 1}`, ...h })),
        })),
      };
      courses.push(course);
      return course;
    },
    async get(id) {
      return courses.find((c) => c.id === id) ?? null;
    },
  };
}

const silentLogger = createLogger("test");

test("createCourse persists tee configurations and holes via the repository", async () => {
  const service = createCoursesService(fakeRepository(), silentLogger);

  const course = await service.createCourse({
    name: "Club de Golf Terramar",
    country: "ES",
    teeConfigurations: [
      {
        name: "White",
        holeCount: 18,
        courseRating: 71.2,
        slopeRating: 128,
        holes: [{ holeNumber: 1, distanceYards: 380, par: 4, strokeIndex: 7 }],
      },
    ],
  });

  assert.equal(course.teeConfigurations.length, 1);
  assert.equal(course.teeConfigurations[0]!.holes.length, 1);
  assert.equal(course.teeConfigurations[0]!.slopeRating, 128);
});

test("getCourse returns null for an unknown id", async () => {
  const service = createCoursesService(fakeRepository(), silentLogger);

  assert.equal(await service.getCourse("does-not-exist"), null);
});
