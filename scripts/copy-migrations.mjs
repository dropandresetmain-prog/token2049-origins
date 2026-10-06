import { cpSync, mkdirSync } from 'node:fs';

mkdirSync('dist/src/migrations', { recursive: true });
cpSync('src/migrations', 'dist/src/migrations', { recursive: true });
