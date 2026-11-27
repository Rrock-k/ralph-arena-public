#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const scenario = process.env.ARENA_MOCK_OPENCODE_SCENARIO || 'success';
const completionSignal = '<promise>TASK_COMPLETE</promise>';

if (args.includes('--version')) {
  console.log('opencode mock 1.0.0');
  process.exit(0);
}

if (process.env.ARENA_MOCK_OPENCODE_ARGS_FILE) {
  let invocations = [];
  try {
    invocations = JSON.parse(readFileSync(process.env.ARENA_MOCK_OPENCODE_ARGS_FILE, 'utf8'));
  } catch {
    invocations = [];
  }
  invocations.push(args);
  writeFileSync(process.env.ARENA_MOCK_OPENCODE_ARGS_FILE, JSON.stringify(invocations));
}

if (process.env.ARENA_MOCK_OPENCODE_ENV_FILE) {
  let configFileContent = null;
  if (process.env.OPENCODE_CONFIG) {
    try {
      configFileContent = readFileSync(process.env.OPENCODE_CONFIG, 'utf8');
    } catch {
      configFileContent = null;
    }
  }
  writeFileSync(process.env.ARENA_MOCK_OPENCODE_ENV_FILE, JSON.stringify({
    OPENCODE_API_KEY: process.env.OPENCODE_API_KEY ? 'present' : 'missing',
    OPENCODE_CONFIG: process.env.OPENCODE_CONFIG || null,
    OPENCODE_CONFIG_FILE_CONTENT: configFileContent,
    OPENCODE_CONFIG_CONTENT: process.env.OPENCODE_CONFIG_CONTENT || null,
  }));
}

let stdin = '';
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) {
  stdin += chunk;
}
const prompt = stdin.trim() || args.at(-1) || '';

switch (scenario) {
  case 'timeout_hang':
    // Emit the session id, then hang so the agent's own timeout fires SIGTERM.
    console.log(JSON.stringify({
      type: 'step_start',
      properties: {
        sessionID: 'mock-opencode-session',
      },
    }));
    setInterval(() => {}, 1000);
    break;
  case 'success':
    console.log(JSON.stringify({
      type: 'step_start',
      properties: {
        sessionID: 'mock-opencode-session',
      },
    }));
    console.log(JSON.stringify({
      type: 'message',
      text: `mock opencode response: ${prompt}`,
      usage: {
        input_tokens: 11,
        output_tokens: 7,
      },
    }));
    process.exit(0);
    break;
  case 'resume_missing':
    if (args.includes('--session')) {
      console.error(`No session found for ${args[args.indexOf('--session') + 1] || 'unknown'}.`);
      process.exit(1);
    }
    console.log(JSON.stringify({
      type: 'step_start',
      properties: {
        sessionID: 'mock-opencode-session',
      },
    }));
    console.log(JSON.stringify({
      type: 'message',
      text: `mock opencode response: ${prompt}`,
    }));
    process.exit(0);
    break;
  case 'resume_invalid_option':
    if (args.includes('--session')) {
      console.error('invalid option --session');
      process.exit(1);
    }
    console.log(JSON.stringify({
      type: 'step_start',
      properties: {
        sessionID: 'mock-opencode-session',
      },
    }));
    console.log(JSON.stringify({
      type: 'message',
      text: `mock opencode response: ${prompt}`,
    }));
    process.exit(0);
    break;
  case 'nested_session_noise':
    console.log(JSON.stringify({
      type: 'message',
      properties: {
        sessionID: 'wrong-nested-session',
      },
      text: 'noise event',
    }));
    console.log(JSON.stringify({
      type: 'step_start',
      properties: {
        sessionID: 'mock-opencode-session',
      },
    }));
    console.log(JSON.stringify({
      type: 'message',
      text: `mock opencode response: ${prompt}`,
    }));
    process.exit(0);
    break;
  case 'part_text_success':
    console.log(JSON.stringify({
      type: 'text',
      part: {
        text: '```json\n{"projectGoal":"OpenCode smoke","phases":[],"judgments":[]}\n```',
      },
      usage: {
        input_tokens: 13,
        output_tokens: 17,
      },
    }));
    process.exit(0);
    break;
  case 'stderr_notice_success':
    console.error('OpenCode notice: using cached provider metadata.');
    console.log(JSON.stringify({
      type: 'message',
      text: `mock opencode response: ${prompt}`,
    }));
    process.exit(0);
    break;
  case 'no_tools_dsml_tool_calls':
    console.log(JSON.stringify({
      type: 'message',
      text: [
        'Let me examine the project files first.',
        '<||DSML||tool_calls>',
        '{"name":"read","arguments":{"filePath":"package.json"}}',
        '</||DSML||tool_calls>',
      ].join('\n'),
    }));
    process.exit(0);
    break;
  case 'no_tools_xml_tool_calls':
    console.log(JSON.stringify({
      type: 'message',
      text: [
        "I'll inspect the repository before answering.",
        '<read_file>',
        '<path>server.js</path>',
        '</read_file>',
      ].join('\n'),
    }));
    process.exit(0);
    break;
  case 'no_tools_event_only':
    console.log(JSON.stringify({
      type: 'step_start',
      properties: {
        sessionID: 'mock-session',
        messageID: 'mock-message',
      },
    }));
    console.log(JSON.stringify({
      type: 'step_finish',
      part: {
        type: 'step-finish',
        reason: 'unknown',
        tokens: {
          input: 0,
          output: 0,
          reasoning: 0,
          cache: {
            read: 0,
            write: 0,
          },
        },
        cost: 0,
      },
    }));
    process.exit(0);
    break;
  case 'auth':
    console.error('Authentication required: OPENCODE_API_KEY is missing.');
    process.exit(1);
    break;
  case 'config':
    console.error('Unknown model: opencode/not-real.');
    process.exit(1);
    break;
  case 'rate_limit':
    console.error('Rate limit reached: 429 too many requests.');
    process.exit(1);
    break;
  case 'completion_then_rate_limit':
    console.log(JSON.stringify({
      type: 'message',
      text: `Finished implementation.\n${completionSignal}`,
    }));
    console.error('Rate limit reached: 429 too many requests.');
    process.exit(1);
    break;
  case 'budget':
    console.error('Insufficient balance for OpenCode Zen request.');
    process.exit(1);
    break;
  case 'infra':
    console.error('Network error: service unavailable 503.');
    process.exit(1);
    break;
  case 'infra_e2big':
    console.error('spawn E2BIG');
    process.exit(1);
    break;
  case 'structured_error':
    console.log(JSON.stringify({
      type: 'turn.failed',
      error: {
        message: 'Unsupported model: opencode/not-real',
      },
    }));
    process.exit(0);
    break;
  case 'empty_success':
    process.exit(0);
    break;
  default:
    console.error(`Unknown mock scenario: ${scenario}`);
    process.exit(2);
}
