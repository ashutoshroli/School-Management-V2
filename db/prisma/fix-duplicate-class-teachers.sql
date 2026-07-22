-- One-time data-cleanup step, run BEFORE `prisma db push`/`migrate` on
-- any environment that had sections/staff created before
-- `Section.classTeacherId` became `@unique` (see schema.prisma's own
-- comment on that field, added alongside the "one-to-one" ClassTeacher
-- relation on Staff).
--
-- ROOT CAUSE: a school running this app before that constraint existed
-- could have (accidentally, or via generateDemoDataForBranch's old bug
-- - see demoData.service.ts's "BUG FIX" comment on class-teacher
-- assignment) assigned the SAME staff member as classTeacherId on more
-- than one Section. Postgres refuses to add a UNIQUE index/constraint
-- while duplicate values already exist in the column, so
-- `prisma db push --accept-data-loss` (or a real `prisma migrate
-- deploy` applying that constraint for the first time) fails outright
-- with:
--     Error: P2002
--     Unique constraint failed on the fields: (`classTeacherId`)
-- and the container never starts (see the Dockerfile's CMD, which runs
-- `prisma db push` at every container startup - so this isn't a
-- one-off migration failure, it's a crash-loop on every single deploy
-- until the underlying duplicate data is fixed).
--
-- FIX: for every staff member assigned as class teacher on more than
-- one section, keep only their MOST RECENTLY UPDATED section's
-- assignment and null out the rest - matching exactly the "at most one
-- section at a time" rule the constraint itself is meant to enforce,
-- and mirroring generateDemoDataForBranch's own fixed logic (hand out
-- teachers WITHOUT replacement, excess sections stay unassigned rather
-- than erroring).
--
-- Safe to run multiple times (idempotent - a second run finds nothing
-- left to dedupe) and safe to run on a database that has never had any
-- Section rows at all (the CTE simply matches zero rows).
--
-- Usage: for an environment ALREADY stuck in the crash loop described
-- above (i.e. to unblock a deploy that is failing right now), run this
-- once, by hand, against that SAME database (the one DATABASE_URL
-- points at) using `psql` or Prisma's own executor, e.g.:
--     npx prisma db execute --file prisma/fix-duplicate-class-teachers.sql --schema prisma/schema.prisma
-- (run from inside the `db/` package directory, with DATABASE_URL set
-- in the environment). Once run, the next deploy's `prisma db push`
-- will succeed.
--
-- This file is ALSO wired into backend/scripts/build.sh and
-- backend/Dockerfile's CMD so it runs automatically, immediately
-- before `prisma db push`, on every future deploy from now on -
-- manual intervention is only ever needed for a deploy that was
-- already crash-looping before this fix was added.

WITH ranked AS (
  SELECT
    id,
    "classTeacherId",
    ROW_NUMBER() OVER (
      PARTITION BY "classTeacherId"
      ORDER BY "updatedAt" DESC, id DESC
    ) AS rn
  FROM "Section"
  WHERE "classTeacherId" IS NOT NULL
)
UPDATE "Section" s
SET "classTeacherId" = NULL
FROM ranked r
WHERE s.id = r.id
  AND r.rn > 1;
