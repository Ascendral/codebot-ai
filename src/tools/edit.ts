import * as fs from 'fs';
import * as path from 'path';
import { Tool } from '../types';

export class EditFileTool implements Tool {
  name = 'edit_file';
  description = 'Edit a file by replacing an exact string match with new content. The old_string must appear exactly once in the file.';
  permission: Tool['permission'] = 'prompt';
  parameters = {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Path to the file to edit' },
      old_string: { type: 'string', description: 'Exact string to find (must be unique in the file)' },
      new_string: { type: 'string', description: 'Replacement string' },
    },
    required: ['path', 'old_string', 'new_string'],
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    if (!args.path || typeof args.path !== 'string') {
      return 'Error: path is required';
    }
    if (args.old_string === undefined || args.old_string === null) {
      return 'Error: old_string is required';
    }
    if (args.new_string === undefined || args.new_string === null) {
      return 'Error: new_string is required';
    }
    const filePath = path.resolve(args.path);
    const oldStr = String(args.old_string);
    const newStr = String(args.new_string);

    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    const count = content.split(oldStr).length - 1;

    if (count === 0) {
      throw new Error(`String not found in ${filePath}. Make sure old_string matches exactly (including whitespace).`);
    }
    if (count > 1) {
      throw new Error(`String found ${count} times in ${filePath}. Provide more surrounding context to make it unique.`);
    }

    const updated = content.replace(oldStr, newStr);
    fs.writeFileSync(filePath, updated, 'utf-8');

    return `Edited ${filePath} (1 replacement)`;
  }
}
