import { invoke } from '@tauri-apps/api/core';

export const runPromptAssistantTask = async (request) => {
  return invoke('run_prompt_assistant_task', { request });
};
