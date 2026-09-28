ALTER TABLE "Prospect"
  ADD COLUMN "jobTitle" TEXT,
  ADD COLUMN "industry" TEXT,
  ADD COLUMN "country" TEXT,
  ADD COLUMN "location" TEXT,
  ADD COLUMN "companySizeMin" INTEGER,
  ADD COLUMN "companySizeMax" INTEGER;

ALTER TABLE "Prospect"
  ADD CONSTRAINT "Prospect_companySize_range" CHECK (
    ("companySizeMin" IS NULL OR "companySizeMin" >= 0) AND
    ("companySizeMax" IS NULL OR "companySizeMax" >= 0) AND
    ("companySizeMin" IS NULL OR "companySizeMax" IS NULL OR "companySizeMin" <= "companySizeMax")
  );
