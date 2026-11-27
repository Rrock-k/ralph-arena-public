-- A tg-spec source version is immutable identity within its mirror spec.
CREATE UNIQUE INDEX "SpecVersion_specId_externalSourceSystem_externalSourceProjectId_externalSourceVersion_key"
  ON "SpecVersion"("specId", "externalSourceSystem", "externalSourceProjectId", "externalSourceVersion");
