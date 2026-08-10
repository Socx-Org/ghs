import type { Logger } from "../logger.ts";
import type { Course, CourseSummary, CoursesRepository, CreateCourseInput } from "../data/courses.repository.ts";

export interface CoursesService {
  listCourses(): Promise<CourseSummary[]>;
  createCourse(input: CreateCourseInput): Promise<Course>;
  getCourse(id: string): Promise<Course | null>;
}

export function createCoursesService(repository: CoursesRepository, logger: Logger): CoursesService {
  return {
    async listCourses() {
      return repository.list();
    },

    async createCourse(input) {
      const course = await repository.create(input);
      logger.info("course created", {
        courseId: course.id,
        clubId: course.clubId,
        teeConfigurationCount: course.teeConfigurations.length,
      });
      return course;
    },

    async getCourse(id) {
      return repository.get(id);
    },
  };
}
