import { test } from "node:test";
import assert from "node:assert/strict";
import { createCoursesService } from "../src/application/courses.service.ts";
import { createLogger } from "../src/logger.ts";
import type { Course, CoursesRepository, CreateCourseInput, TeeConfiguration } from "../src/data/courses.repository.ts";

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
    async getTeeConfiguration(id) {
      for (const course of courses) {
        const found = course.teeConfigurations.find((tc) => tc.id === id);
        if (found) return found;
      }
      return null;
    },
    async update(id, input) {
      const course = courses.find((c) => c.id === id);
      if (!course) return null;
      if (input.name !== undefined) course.name = input.name;
      if (input.clubId !== undefined) course.clubId = input.clubId;
      if (input.city !== undefined) course.city = input.city;
      if (input.country !== undefined) course.country = input.country;
      return course;
    },
    async delete(id) {
      const index = courses.findIndex((c) => c.id === id);
      if (index === -1) return false;
      courses.splice(index, 1);
      return true;
    },
    async createTeeConfiguration(courseId, input) {
      const course = courses.find((c) => c.id === courseId);
      if (!course) return null;
      const tee: TeeConfiguration = {
        id: `tee-${courseId}-${course.teeConfigurations.length + 1}`,
        name: input.name,
        holeCount: input.holeCount,
        courseRating: input.courseRating,
        slopeRating: input.slopeRating,
        holes: input.holes.map((h, j) => ({ id: `hole-${j + 1}`, ...h })),
      };
      course.teeConfigurations.push(tee);
      return tee;
    },
    async updateTeeConfiguration(id, input) {
      for (const course of courses) {
        const tee = course.teeConfigurations.find((tc) => tc.id === id);
        if (tee) {
          tee.name = input.name;
          tee.holeCount = input.holeCount;
          tee.courseRating = input.courseRating;
          tee.slopeRating = input.slopeRating;
          tee.holes = input.holes.map((h, j) => ({ id: `hole-${j + 1}`, ...h }));
          return tee;
        }
      }
      return null;
    },
    async deleteTeeConfiguration(id) {
      for (const course of courses) {
        const index = course.teeConfigurations.findIndex((tc) => tc.id === id);
        if (index !== -1) {
          course.teeConfigurations.splice(index, 1);
          return true;
        }
      }
      return false;
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

// ghs#99
test("updateCourse applies only the fields provided, leaving the rest unchanged", async () => {
  const service = createCoursesService(fakeRepository(), silentLogger);
  const created = await service.createCourse({ name: "Original Name", city: "Original City", country: "ES" });

  const updated = await service.updateCourse(created.id, { name: "New Name" });

  assert.ok(updated);
  assert.equal(updated!.name, "New Name");
  assert.equal(updated!.city, "Original City", "city was not part of this update, must be unchanged");
});

test("updateCourse returns null for an unknown id", async () => {
  const service = createCoursesService(fakeRepository(), silentLogger);

  assert.equal(await service.updateCourse("does-not-exist", { name: "Anything" }), null);
});

test("deleteCourse returns true when the course existed, false for an unknown id", async () => {
  const service = createCoursesService(fakeRepository(), silentLogger);
  const created = await service.createCourse({ name: "Deletable Course" });

  assert.equal(await service.deleteCourse("does-not-exist"), false);
  assert.equal(await service.deleteCourse(created.id), true);
  assert.equal(await service.getCourse(created.id), null, "deleted course must no longer be gettable");
});

test("createTeeConfiguration adds a tee configuration to an existing course, returns null for an unknown course", async () => {
  const service = createCoursesService(fakeRepository(), silentLogger);
  const created = await service.createCourse({ name: "Course For New Tee" });

  const tee = await service.createTeeConfiguration(created.id, {
    name: "Blue",
    holeCount: 18,
    courseRating: 73.5,
    slopeRating: 132,
    holes: [{ holeNumber: 1, distanceYards: 400, par: 4, strokeIndex: 1 }],
  });

  assert.ok(tee);
  assert.equal(tee!.name, "Blue");
  const refetched = await service.getCourse(created.id);
  assert.equal(refetched!.teeConfigurations.length, 1);

  assert.equal(
    await service.createTeeConfiguration("does-not-exist", {
      name: "Red",
      holeCount: 18,
      courseRating: 70,
      slopeRating: 120,
      holes: [],
    }),
    null,
  );
});

test("updateTeeConfiguration replaces an existing tee configuration's fields, returns null for an unknown id", async () => {
  const service = createCoursesService(fakeRepository(), silentLogger);
  const created = await service.createCourse({
    name: "Course For Tee Update",
    teeConfigurations: [
      { name: "White", holeCount: 18, courseRating: 71, slopeRating: 120, holes: [] },
    ],
  });
  const teeId = created.teeConfigurations[0]!.id;

  const updated = await service.updateTeeConfiguration(teeId, {
    name: "White (Updated)",
    holeCount: 18,
    courseRating: 72.5,
    slopeRating: 125,
    holes: [{ holeNumber: 1, distanceYards: 410, par: 4, strokeIndex: 2 }],
  });

  assert.ok(updated);
  assert.equal(updated!.name, "White (Updated)");
  assert.equal(updated!.holes.length, 1);
  assert.equal(await service.updateTeeConfiguration("does-not-exist", updated!), null);
});

test("deleteTeeConfiguration returns true when it existed, false for an unknown id", async () => {
  const service = createCoursesService(fakeRepository(), silentLogger);
  const created = await service.createCourse({
    name: "Course For Tee Delete",
    teeConfigurations: [
      { name: "White", holeCount: 18, courseRating: 71, slopeRating: 120, holes: [] },
    ],
  });
  const teeId = created.teeConfigurations[0]!.id;

  assert.equal(await service.deleteTeeConfiguration("does-not-exist"), false);
  assert.equal(await service.deleteTeeConfiguration(teeId), true);
});
