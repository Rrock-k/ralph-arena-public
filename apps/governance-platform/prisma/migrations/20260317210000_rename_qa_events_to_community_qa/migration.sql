-- Rename capability "qa_events" → "community_qa" in AgentLoopVersion.capabilities arrays
UPDATE "AgentLoopVersion"
SET capabilities = array_replace(capabilities, 'qa_events', 'community_qa')
WHERE 'qa_events' = ANY(capabilities);
