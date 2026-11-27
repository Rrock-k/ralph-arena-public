-- RA-265: Ralph is the bundled first-party loop runtime shipped inside Arena.
-- Fresh/current DBs should not depend on external loopdir/sourceUrl semantics for Ralph.

UPDATE "AgentLoopVersion"
SET "commandTemplate" = 'node /ralph/dist/index.js run --work-dir {workdir} --spec-dir {specdir} --agent {agent} --model {model}'
WHERE id = 'ralph-v150';

UPDATE "AgentLoop"
SET "sourceUrl" = NULL,
    "installCommand" = NULL,
    "updatedAt" = now()
WHERE id = 'ralph';
