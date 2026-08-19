import type { Logger } from "../logger.ts";
import type { Course, CourseSummary, CoursesRepository, CreateCourseInput, TeeConfiguration } from "../data/courses.repository.ts";

export interface CoursesService {
  listCourses(): Promise<CourseSummary[]>;
  createCourse(input: CreateCourseInput): Promise<Course>;
  getCourse(id: string): Promise<Course | null>;
  // ghs#92: a round only stores teeConfigurationId, not the owning
  // course id -- resuming an in-progress round (fetching hole/par data
  // to render the entry screen) has no path through getCourse alone.
  getTeeConfiguration(id: string): Promise<TeeConfiguration | null>;
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

    async getTeeConfiguration(id) {
      return repository.getTeeConfiguration(id);
    },
  };
}
