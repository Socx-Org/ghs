import type { Logger } from "../logger.ts";
import type {
  Course,
  CourseSummary,
  CoursesRepository,
  CreateCourseInput,
  CreateTeeConfigurationInput,
  TeeConfiguration,
  UpdateCourseInput,
  UpdateTeeConfigurationInput,
} from "../data/courses.repository.ts";

export interface CoursesService {
  listCourses(): Promise<CourseSummary[]>;
  createCourse(input: CreateCourseInput): Promise<Course>;
  getCourse(id: string): Promise<Course | null>;
  // ghs#92: a round only stores teeConfigurationId, not the owning
  // course id -- resuming an in-progress round (fetching hole/par data
  // to render the entry screen) has no path through getCourse alone.
  getTeeConfiguration(id: string): Promise<TeeConfiguration | null>;
  // ghs#99. Thin pass-throughs, same reasoning as createCourse/getCourse
  // above -- not/found and has-rounds-conflict signalling both already
  // live at the repository layer (null / thrown CourseHasRoundsError
  // resp. TeeConfigurationHasRoundsError), so there's nothing left for
  // this layer to add beyond the same operational logging createCourse
  // already does.
  updateCourse(id: string, input: UpdateCourseInput): Promise<Course | null>;
  deleteCourse(id: string): Promise<boolean>;
  createTeeConfiguration(courseId: string, input: CreateTeeConfigurationInput): Promise<TeeConfiguration | null>;
  updateTeeConfiguration(id: string, input: UpdateTeeConfigurationInput): Promise<TeeConfiguration | null>;
  deleteTeeConfiguration(id: string): Promise<boolean>;
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

    async updateCourse(id, input) {
      const course = await repository.update(id, input);
      if (course) logger.info("course updated", { courseId: course.id });
      return course;
    },

    async deleteCourse(id) {
      const deleted = await repository.delete(id);
      if (deleted) logger.info("course deleted", { courseId: id });
      return deleted;
    },

    async createTeeConfiguration(courseId, input) {
      const teeConfiguration = await repository.createTeeConfiguration(courseId, input);
      if (teeConfiguration) logger.info("tee configuration created", { courseId, teeConfigurationId: teeConfiguration.id });
      return teeConfiguration;
    },

    async updateTeeConfiguration(id, input) {
      const teeConfiguration = await repository.updateTeeConfiguration(id, input);
      if (teeConfiguration) logger.info("tee configuration updated", { teeConfigurationId: teeConfiguration.id });
      return teeConfiguration;
    },

    async deleteTeeConfiguration(id) {
      const deleted = await repository.deleteTeeConfiguration(id);
      if (deleted) logger.info("tee configuration deleted", { teeConfigurationId: id });
      return deleted;
    },
  };
}
