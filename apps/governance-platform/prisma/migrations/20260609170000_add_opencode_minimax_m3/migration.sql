-- Add MiniMax M3 to the OpenCode Zen free model registry.

UPDATE "Tool"
SET
  models = $$[
    {"id":"deepseek-v4-flash-free","label":"DeepSeek V4 Flash Free","model":"opencode/deepseek-v4-flash-free"},
    {"id":"big-pickle","label":"Big Pickle Free","model":"opencode/big-pickle"},
    {"id":"nemotron-3-super-free","label":"Nemotron 3 Super Free","model":"opencode/nemotron-3-super-free"},
    {"id":"minimax-m3-free","label":"MiniMax M3 Free","model":"opencode/minimax-m3-free"}
  ]$$,
  "updatedAt" = now()
WHERE id = 'opencode';
