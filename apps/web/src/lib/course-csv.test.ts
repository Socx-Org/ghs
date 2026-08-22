import { describe, expect, it } from "vitest";
import { CourseCsvParseError, parseCourseCsv } from "./course-csv";

// ghs#155: the two real sample files this issue was filed with -- kept
// verbatim, not trimmed down, so these tests exercise the actual data
// shape a real admin will upload (a 9-hole config with no rating, an
// 18-hole config with one, two tee colours, one of which is already
// baked into its own configuration_name).
const LLAVANERAS_CSV = `course_id,course_name,course_city,course_country,configuration_id,configuration_name,tee_colour,hole_count,course_rating,slope_rating,hole_number,distance_yards,par,stroke_index
79bcacd6-9bd6-47ff-9015-cb1c331993d6,Club de Golf Llavaneras,Catalonia,ES,215c74f9-8d92-43f2-85f1-df765ca0b69f,Members,White,9,,,1,300,5,1
79bcacd6-9bd6-47ff-9015-cb1c331993d6,Club de Golf Llavaneras,Catalonia,ES,215c74f9-8d92-43f2-85f1-df765ca0b69f,Members,White,9,,,2,310,4,2
79bcacd6-9bd6-47ff-9015-cb1c331993d6,Club de Golf Llavaneras,Catalonia,ES,215c74f9-8d92-43f2-85f1-df765ca0b69f,Members,White,9,,,3,320,4,3
79bcacd6-9bd6-47ff-9015-cb1c331993d6,Club de Golf Llavaneras,Catalonia,ES,215c74f9-8d92-43f2-85f1-df765ca0b69f,Members,White,9,,,4,330,5,4
79bcacd6-9bd6-47ff-9015-cb1c331993d6,Club de Golf Llavaneras,Catalonia,ES,215c74f9-8d92-43f2-85f1-df765ca0b69f,Members,White,9,,,5,340,4,5
79bcacd6-9bd6-47ff-9015-cb1c331993d6,Club de Golf Llavaneras,Catalonia,ES,215c74f9-8d92-43f2-85f1-df765ca0b69f,Members,White,9,,,6,350,4,6
79bcacd6-9bd6-47ff-9015-cb1c331993d6,Club de Golf Llavaneras,Catalonia,ES,215c74f9-8d92-43f2-85f1-df765ca0b69f,Members,White,9,,,7,360,5,7
79bcacd6-9bd6-47ff-9015-cb1c331993d6,Club de Golf Llavaneras,Catalonia,ES,215c74f9-8d92-43f2-85f1-df765ca0b69f,Members,White,9,,,8,370,4,8
79bcacd6-9bd6-47ff-9015-cb1c331993d6,Club de Golf Llavaneras,Catalonia,ES,215c74f9-8d92-43f2-85f1-df765ca0b69f,Members,White,9,,,9,380,4,9
79bcacd6-9bd6-47ff-9015-cb1c331993d6,Club de Golf Llavaneras,Catalonia,ES,4e85a163-8d6a-4355-acb9-31cad382d334,Club de Golf Llavaneras,Blue,18,70.0,120,1,234,4,17
79bcacd6-9bd6-47ff-9015-cb1c331993d6,Club de Golf Llavaneras,Catalonia,ES,4e85a163-8d6a-4355-acb9-31cad382d334,Club de Golf Llavaneras,Blue,18,70.0,120,2,125,3,13
79bcacd6-9bd6-47ff-9015-cb1c331993d6,Club de Golf Llavaneras,Catalonia,ES,4e85a163-8d6a-4355-acb9-31cad382d334,Club de Golf Llavaneras,Blue,18,70.0,120,3,421,5,1
79bcacd6-9bd6-47ff-9015-cb1c331993d6,Club de Golf Llavaneras,Catalonia,ES,4e85a163-8d6a-4355-acb9-31cad382d334,Club de Golf Llavaneras,Blue,18,70.0,120,4,296,3,5
79bcacd6-9bd6-47ff-9015-cb1c331993d6,Club de Golf Llavaneras,Catalonia,ES,4e85a163-8d6a-4355-acb9-31cad382d334,Club de Golf Llavaneras,Blue,18,70.0,120,5,156,4,7
79bcacd6-9bd6-47ff-9015-cb1c331993d6,Club de Golf Llavaneras,Catalonia,ES,4e85a163-8d6a-4355-acb9-31cad382d334,Club de Golf Llavaneras,Blue,18,70.0,120,6,268,4,9
79bcacd6-9bd6-47ff-9015-cb1c331993d6,Club de Golf Llavaneras,Catalonia,ES,4e85a163-8d6a-4355-acb9-31cad382d334,Club de Golf Llavaneras,Blue,18,70.0,120,7,405,5,3
79bcacd6-9bd6-47ff-9015-cb1c331993d6,Club de Golf Llavaneras,Catalonia,ES,4e85a163-8d6a-4355-acb9-31cad382d334,Club de Golf Llavaneras,Blue,18,70.0,120,8,112,3,15
79bcacd6-9bd6-47ff-9015-cb1c331993d6,Club de Golf Llavaneras,Catalonia,ES,4e85a163-8d6a-4355-acb9-31cad382d334,Club de Golf Llavaneras,Blue,18,70.0,120,9,264,4,11
79bcacd6-9bd6-47ff-9015-cb1c331993d6,Club de Golf Llavaneras,Catalonia,ES,4e85a163-8d6a-4355-acb9-31cad382d334,Club de Golf Llavaneras,Blue,18,70.0,120,10,256,4,12
79bcacd6-9bd6-47ff-9015-cb1c331993d6,Club de Golf Llavaneras,Catalonia,ES,4e85a163-8d6a-4355-acb9-31cad382d334,Club de Golf Llavaneras,Blue,18,70.0,120,11,257,4,2
79bcacd6-9bd6-47ff-9015-cb1c331993d6,Club de Golf Llavaneras,Catalonia,ES,4e85a163-8d6a-4355-acb9-31cad382d334,Club de Golf Llavaneras,Blue,18,70.0,120,12,301,4,4
79bcacd6-9bd6-47ff-9015-cb1c331993d6,Club de Golf Llavaneras,Catalonia,ES,4e85a163-8d6a-4355-acb9-31cad382d334,Club de Golf Llavaneras,Blue,18,70.0,120,13,247,4,10
79bcacd6-9bd6-47ff-9015-cb1c331993d6,Club de Golf Llavaneras,Catalonia,ES,4e85a163-8d6a-4355-acb9-31cad382d334,Club de Golf Llavaneras,Blue,18,70.0,120,14,268,4,8
79bcacd6-9bd6-47ff-9015-cb1c331993d6,Club de Golf Llavaneras,Catalonia,ES,4e85a163-8d6a-4355-acb9-31cad382d334,Club de Golf Llavaneras,Blue,18,70.0,120,15,95,3,18
79bcacd6-9bd6-47ff-9015-cb1c331993d6,Club de Golf Llavaneras,Catalonia,ES,4e85a163-8d6a-4355-acb9-31cad382d334,Club de Golf Llavaneras,Blue,18,70.0,120,16,397,5,6
79bcacd6-9bd6-47ff-9015-cb1c331993d6,Club de Golf Llavaneras,Catalonia,ES,4e85a163-8d6a-4355-acb9-31cad382d334,Club de Golf Llavaneras,Blue,18,70.0,120,17,230,4,16
79bcacd6-9bd6-47ff-9015-cb1c331993d6,Club de Golf Llavaneras,Catalonia,ES,4e85a163-8d6a-4355-acb9-31cad382d334,Club de Golf Llavaneras,Blue,18,70.0,120,18,118,3,14`;

const COSTA_BRAVA_CSV = `course_id,course_name,course_city,course_country,configuration_id,configuration_name,tee_colour,hole_count,course_rating,slope_rating,hole_number,distance_yards,par,stroke_index
eaacb487-1275-4546-aefe-0a25ddb4533c,Golf Costa Brava - Verde,d'Aro,ES,c491f897-afaf-4c0c-9e48-af3a07f828ba,Golf Costa Brava - Verde - Blue Tee (Male),Blue,18,67.6,124,1,279,4,7
eaacb487-1275-4546-aefe-0a25ddb4533c,Golf Costa Brava - Verde,d'Aro,ES,c491f897-afaf-4c0c-9e48-af3a07f828ba,Golf Costa Brava - Verde - Blue Tee (Male),Blue,18,67.6,124,2,298,4,13
eaacb487-1275-4546-aefe-0a25ddb4533c,Golf Costa Brava - Verde,d'Aro,ES,c491f897-afaf-4c0c-9e48-af3a07f828ba,Golf Costa Brava - Verde - Blue Tee (Male),Blue,18,67.6,124,3,125,3,17
eaacb487-1275-4546-aefe-0a25ddb4533c,Golf Costa Brava - Verde,d'Aro,ES,c491f897-afaf-4c0c-9e48-af3a07f828ba,Golf Costa Brava - Verde - Blue Tee (Male),Blue,18,67.6,124,4,425,5,3
eaacb487-1275-4546-aefe-0a25ddb4533c,Golf Costa Brava - Verde,d'Aro,ES,c491f897-afaf-4c0c-9e48-af3a07f828ba,Golf Costa Brava - Verde - Blue Tee (Male),Blue,18,67.6,124,5,179,3,9
eaacb487-1275-4546-aefe-0a25ddb4533c,Golf Costa Brava - Verde,d'Aro,ES,c491f897-afaf-4c0c-9e48-af3a07f828ba,Golf Costa Brava - Verde - Blue Tee (Male),Blue,18,67.6,124,6,396,4,1
eaacb487-1275-4546-aefe-0a25ddb4533c,Golf Costa Brava - Verde,d'Aro,ES,c491f897-afaf-4c0c-9e48-af3a07f828ba,Golf Costa Brava - Verde - Blue Tee (Male),Blue,18,67.6,124,7,319,4,5
eaacb487-1275-4546-aefe-0a25ddb4533c,Golf Costa Brava - Verde,d'Aro,ES,c491f897-afaf-4c0c-9e48-af3a07f828ba,Golf Costa Brava - Verde - Blue Tee (Male),Blue,18,67.6,124,8,120,3,11
eaacb487-1275-4546-aefe-0a25ddb4533c,Golf Costa Brava - Verde,d'Aro,ES,c491f897-afaf-4c0c-9e48-af3a07f828ba,Golf Costa Brava - Verde - Blue Tee (Male),Blue,18,67.6,124,9,289,4,15
eaacb487-1275-4546-aefe-0a25ddb4533c,Golf Costa Brava - Verde,d'Aro,ES,c491f897-afaf-4c0c-9e48-af3a07f828ba,Golf Costa Brava - Verde - Blue Tee (Male),Blue,18,67.6,124,10,45,4,10
eaacb487-1275-4546-aefe-0a25ddb4533c,Golf Costa Brava - Verde,d'Aro,ES,c491f897-afaf-4c0c-9e48-af3a07f828ba,Golf Costa Brava - Verde - Blue Tee (Male),Blue,18,67.6,124,11,45,5,16
eaacb487-1275-4546-aefe-0a25ddb4533c,Golf Costa Brava - Verde,d'Aro,ES,c491f897-afaf-4c0c-9e48-af3a07f828ba,Golf Costa Brava - Verde - Blue Tee (Male),Blue,18,67.6,124,12,41,3,8
eaacb487-1275-4546-aefe-0a25ddb4533c,Golf Costa Brava - Verde,d'Aro,ES,c491f897-afaf-4c0c-9e48-af3a07f828ba,Golf Costa Brava - Verde - Blue Tee (Male),Blue,18,67.6,124,13,45,5,14
eaacb487-1275-4546-aefe-0a25ddb4533c,Golf Costa Brava - Verde,d'Aro,ES,c491f897-afaf-4c0c-9e48-af3a07f828ba,Golf Costa Brava - Verde - Blue Tee (Male),Blue,18,67.6,124,14,50,5,2
eaacb487-1275-4546-aefe-0a25ddb4533c,Golf Costa Brava - Verde,d'Aro,ES,c491f897-afaf-4c0c-9e48-af3a07f828ba,Golf Costa Brava - Verde - Blue Tee (Male),Blue,18,67.6,124,15,45,3,12
eaacb487-1275-4546-aefe-0a25ddb4533c,Golf Costa Brava - Verde,d'Aro,ES,c491f897-afaf-4c0c-9e48-af3a07f828ba,Golf Costa Brava - Verde - Blue Tee (Male),Blue,18,67.6,124,16,54,4,4
eaacb487-1275-4546-aefe-0a25ddb4533c,Golf Costa Brava - Verde,d'Aro,ES,c491f897-afaf-4c0c-9e48-af3a07f828ba,Golf Costa Brava - Verde - Blue Tee (Male),Blue,18,67.6,124,17,54,3,18
eaacb487-1275-4546-aefe-0a25ddb4533c,Golf Costa Brava - Verde,d'Aro,ES,c491f897-afaf-4c0c-9e48-af3a07f828ba,Golf Costa Brava - Verde - Blue Tee (Male),Blue,18,67.6,124,18,42,4,6`;

describe("parseCourseCsv", () => {
  it("parses the Llavaneras sample: course fields, both configurations found, the 9-hole no-rating one skipped with a reason, the 18-hole one valid", () => {
    const result = parseCourseCsv(LLAVANERAS_CSV);

    expect(result.name).toBe("Club de Golf Llavaneras");
    expect(result.city).toBe("Catalonia");
    expect(result.country).toBe("ES");
    expect(result.teeConfigurations).toHaveLength(2);

    // "Members" doesn't already mention its own tee colour, unlike the
    // Blue configuration's name below -- combineName appends it.
    const members = result.teeConfigurations.find((tc) => tc.name === "Members (White)");
    expect(members?.valid).toBe(false);
    expect(members?.reason).toMatch(/course rating/i);

    const blue = result.teeConfigurations.find((tc) => tc.name === "Club de Golf Llavaneras (Blue)");
    expect(blue?.valid).toBe(true);
    expect(blue?.input).toEqual({
      name: "Club de Golf Llavaneras (Blue)",
      holeCount: 18,
      courseRating: 70,
      slopeRating: 120,
      holes: [
        { holeNumber: 1, distanceYards: 234, par: 4, strokeIndex: 17 },
        { holeNumber: 2, distanceYards: 125, par: 3, strokeIndex: 13 },
        { holeNumber: 3, distanceYards: 421, par: 5, strokeIndex: 1 },
        { holeNumber: 4, distanceYards: 296, par: 3, strokeIndex: 5 },
        { holeNumber: 5, distanceYards: 156, par: 4, strokeIndex: 7 },
        { holeNumber: 6, distanceYards: 268, par: 4, strokeIndex: 9 },
        { holeNumber: 7, distanceYards: 405, par: 5, strokeIndex: 3 },
        { holeNumber: 8, distanceYards: 112, par: 3, strokeIndex: 15 },
        { holeNumber: 9, distanceYards: 264, par: 4, strokeIndex: 11 },
        { holeNumber: 10, distanceYards: 256, par: 4, strokeIndex: 12 },
        { holeNumber: 11, distanceYards: 257, par: 4, strokeIndex: 2 },
        { holeNumber: 12, distanceYards: 301, par: 4, strokeIndex: 4 },
        { holeNumber: 13, distanceYards: 247, par: 4, strokeIndex: 10 },
        { holeNumber: 14, distanceYards: 268, par: 4, strokeIndex: 8 },
        { holeNumber: 15, distanceYards: 95, par: 3, strokeIndex: 18 },
        { holeNumber: 16, distanceYards: 397, par: 5, strokeIndex: 6 },
        { holeNumber: 17, distanceYards: 230, par: 4, strokeIndex: 16 },
        { holeNumber: 18, distanceYards: 118, par: 3, strokeIndex: 14 },
      ],
    });
  });

  it("parses the Costa Brava sample: one complete 18-hole configuration, name not duplicated since tee_colour is already in configuration_name", () => {
    const result = parseCourseCsv(COSTA_BRAVA_CSV);

    expect(result.name).toBe("Golf Costa Brava - Verde");
    expect(result.city).toBe("d'Aro");
    expect(result.country).toBe("ES");
    expect(result.teeConfigurations).toHaveLength(1);

    const [config] = result.teeConfigurations;
    // "Blue" is already part of configuration_name -- not appended again.
    expect(config!.name).toBe("Golf Costa Brava - Verde - Blue Tee (Male)");
    expect(config!.valid).toBe(true);
    expect(config!.input?.courseRating).toBe(67.6);
    expect(config!.input?.slopeRating).toBe(124);
    expect(config!.input?.holes).toHaveLength(18);
  });

  it("throws CourseCsvParseError for an empty file", () => {
    expect(() => parseCourseCsv("")).toThrow(CourseCsvParseError);
  });

  it("throws CourseCsvParseError when a required column is missing", () => {
    const missingParColumn = "course_name,configuration_id,configuration_name,hole_count,hole_number,distance_yards,stroke_index\nAcme,c1,Blue,9,1,300,1";
    expect(() => parseCourseCsv(missingParColumn)).toThrow(/Missing required column/);
  });

  it("throws CourseCsvParseError when the header is present but there are no data rows", () => {
    const headerOnly = "course_id,course_name,course_city,course_country,configuration_id,configuration_name,tee_colour,hole_count,course_rating,slope_rating,hole_number,distance_yards,par,stroke_index";
    expect(() => parseCourseCsv(headerOnly)).toThrow(/no data rows/);
  });

  it("skips a tee configuration missing hole rows, reporting exactly which hole numbers are absent", () => {
    const missingHole2 = [
      "course_id,course_name,course_city,course_country,configuration_id,configuration_name,tee_colour,hole_count,course_rating,slope_rating,hole_number,distance_yards,par,stroke_index",
      "c1,Acme,City,US,cfg1,Blue,Blue,9,68.0,120,1,300,4,1",
      "c1,Acme,City,US,cfg1,Blue,Blue,9,68.0,120,3,320,4,3",
    ].join("\n");
    const result = parseCourseCsv(missingHole2);
    expect(result.teeConfigurations[0]!.valid).toBe(false);
    expect(result.teeConfigurations[0]!.reason).toMatch(/missing hole\(s\): 2/);
  });

  it("skips a tee configuration with a duplicate hole number", () => {
    const duplicateHole = [
      "course_id,course_name,course_city,course_country,configuration_id,configuration_name,tee_colour,hole_count,course_rating,slope_rating,hole_number,distance_yards,par,stroke_index",
      "c1,Acme,City,US,cfg1,Blue,Blue,9,68.0,120,1,300,4,1",
      "c1,Acme,City,US,cfg1,Blue,Blue,9,68.0,120,1,310,4,2",
    ].join("\n");
    const result = parseCourseCsv(duplicateHole);
    expect(result.teeConfigurations[0]!.valid).toBe(false);
    expect(result.teeConfigurations[0]!.reason).toMatch(/duplicate hole number 1/);
  });

  it("throws CourseCsvParseError when a row has no configuration_id", () => {
    const noConfigId = [
      "course_id,course_name,course_city,course_country,configuration_id,configuration_name,tee_colour,hole_count,course_rating,slope_rating,hole_number,distance_yards,par,stroke_index",
      "c1,Acme,City,US,,Blue,Blue,9,68.0,120,1,300,4,1",
    ].join("\n");
    expect(() => parseCourseCsv(noConfigId)).toThrow(/configuration_id/);
  });
});
