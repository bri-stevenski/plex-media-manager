# Linting & Code Quality Standards

This project uses industry-standard linting and code formatting tools to maintain consistent, high-quality code.

## Tools Configured

### ESLint
**Version:** 8.x  
**Purpose:** Static analysis and code quality enforcement

- **Parser:** `@typescript-eslint/parser` - TypeScript support
- **Plugin:** `@typescript-eslint/eslint-plugin` - TypeScript-specific rules
- **Extends:** `eslint:recommended`, `plugin:@typescript-eslint/recommended`, `prettier`

### Prettier
**Version:** 3.x  
**Purpose:** Automatic code formatting

- **Single quotes:** Enforced
- **Semicolons:** Always required
- **Trailing commas:** All (multiline)
- **Print width:** 100 characters
- **Tab width:** 2 spaces
- **Line endings:** LF (Unix)

## NPM Scripts

### Linting

```bash
# Run ESLint to check for code quality issues
npm run lint

# Run ESLint and automatically fix fixable issues
npm run lint:fix

# Check code formatting with Prettier (no changes)
npm run format:check

# Format all code with Prettier (modifies files)
npm run format

# Run TypeScript type checking
npm run type-check

# Run all validation checks (type-check, lint, format:check)
npm run validate
```

## Configuration Files

### `.eslintrc.json`
Main ESLint configuration file with:
- **Base Rules:** Semicolons, single quotes, spacing, console warnings
- **TypeScript Rules:** Type checking, naming conventions, unused variables
- **Override Rules:** Separate rules for TSX files to allow PascalCase component names

### `.prettierrc`
Prettier formatting configuration with:
- Single quotes for strings
- 100-character line width
- 2-space indentation
- Trailing commas in multiline structures

### `.eslintignore`
Patterns ignored by ESLint:
- `node_modules/`, `dist/`, `.next/`, `build/`
- Generated files and caches
- Lock files and logs

### `.prettierignore`
Patterns ignored by Prettier:
- `node_modules/`, `dist/`, `.next/`, `build/`
- Lock files, logs, and generated files
- Testing and IDE files

## Code Style Guidelines

### TypeScript & JavaScript

#### Naming Conventions
- **Variables:** `camelCase` or `UPPER_CASE` for constants
- **Functions:** `camelCase`
- **Components:** `PascalCase` (React components)
- **Classes:** `PascalCase`
- **Interfaces/Types:** `PascalCase`
- **Enums:** `UPPER_CASE` for members
- **Private members:** `camelCase` with optional leading underscore `_`

#### Formatting
- **Semicolons:** Always required
- **Quotes:** Single quotes (`'`) except JSX attributes
- **Spacing:** 2 spaces for indentation
- **Line length:** Max 100 characters
- **Comma placement:** Trailing commas in multiline structures

#### Import Organization
```typescript
// 1. Node.js built-in modules
import fs from 'fs';
import path from 'path';

// 2. External dependencies
import axios from 'axios';
import { DateTime } from 'luxon';

// 3. Local imports
import { getLogger } from './utils/logger';
import type { MediaInfo } from './types';
```

#### Type Annotations
```typescript
// Prefer type imports for type-only imports
import type { MyType } from './types';

// Use interfaces over type aliases where possible
interface User {
  name: string;
  email: string;
}

// Explicit return types where beneficial (not required for simple functions)
function processData(input: string): Promise<Result> {
  // ...
}
```

#### Variable Declaration
- Use `const` by default
- Use `let` when variable is reassigned
- Avoid `var`

```typescript
const immutableValue = 10;
let mutableValue = 20;
```

#### Arrow Functions
```typescript
// Preferred style for callbacks
const items = array.filter((item) => item.active);

// Always include parentheses around parameters
const greet = (name: string) => `Hello, ${name}`;
```

#### Unused Variables
Prefix with underscore to suppress warnings:
```typescript
// This would trigger @typescript-eslint/no-unused-vars
function process(data: string, _options: Options) {
  return data;
}
```

#### Any Types
- Minimize use of `any`
- When necessary, include a comment explaining why
- Use `unknown` as a safer alternative when possible

```typescript
// Avoid
const value: any = unknownData;

// Prefer
const value: unknown = unknownData;
if (typeof value === 'string') {
  // ...
}
```

### React Components

#### Component Declaration
```typescript
// Use PascalCase for component names
export default function MyComponent(props: Props) {
  return <div>{/* ... */}</div>;
}

// With interfaces
interface Props {
  title: string;
  onClose: () => void;
}
```

#### Props Interface
```typescript
interface ButtonProps {
  label: string;
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
  disabled?: boolean;
}
```

## Common Rules

| Rule | Severity | Purpose |
|------|----------|---------|
| `semi` | Error | Enforce semicolons |
| `quotes` | Error | Single quotes (avoid backticks in regular code) |
| `no-var` | Error | Use `let`/`const` instead |
| `prefer-const` | Error | Use `const` for non-reassigned variables |
| `no-console` | Warn | Allow console.warn/error, flag others |
| `no-unused-vars` | Error | Flag unused variables (with underscore exception) |
| `@typescript-eslint/no-explicit-any` | Warn | Discourage use of `any` type |
| `@typescript-eslint/naming-convention` | Error | Enforce naming standards |
| `@typescript-eslint/consistent-type-imports` | Warn | Use `import type` for types |

## Disabling Rules

### For a Single Line
```typescript
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const data: any = unknownValue;
```

### For a Block
```typescript
/* eslint-disable @typescript-eslint/no-explicit-any */
const data: any = unknownValue;
const more: any = another;
/* eslint-enable @typescript-eslint/no-explicit-any */
```

### For an Entire File
```typescript
/* eslint-disable no-console */
// File contents...
```

## IDE Integration

### VS Code
The project includes `.vscode` settings. Recommended extensions:
- **ESLint** (dbaeumer.vscode-eslint)
- **Prettier** (esbenp.prettier-vscode)

### Settings
Configure your VS Code `settings.json`:
```json
{
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "editor.formatOnSave": true,
  "editor.codeActionsOnSave": {
    "source.fixAll.eslint": true
  },
  "[typescript]": {
    "editor.defaultFormatter": "esbenp.prettier-vscode"
  }
}
```

## Pre-commit Hooks (Optional)

To automatically lint and format before commits, install `husky`:

```bash
npm install --save-dev husky lint-staged
npx husky install
npx husky add .husky/pre-commit "npm run validate"
```

## CI/CD Integration

Add to your CI pipeline to enforce standards:

```bash
# Check formatting
npm run format:check

# Run linting
npm run lint

# Run type checking
npm run type-check

# Or run all validation
npm run validate
```

## Performance Notes

- **Linting speed:** ~5-10s for entire project
- **Formatting speed:** ~2-5s for entire project
- **Type checking:** ~3-8s for entire project

## Troubleshooting

### ESLint errors after setup
1. Clear ESLint cache: `rm -rf .eslintcache`
2. Reinstall packages: `npm install`
3. Verify Node.js version (18.x+ recommended)

### Prettier conflicts with ESLint
- The configuration includes `"prettier"` in extends to disable conflicting rules
- Run `npm run format` before `npm run lint` if issues persist

### Performance issues
- Consider enabling editor-only linting instead of full project
- Use `npm run lint -- --cache` to cache results

## Resources

- [ESLint Documentation](https://eslint.org/)
- [TypeScript ESLint Plugin](https://typescript-eslint.io/)
- [Prettier Documentation](https://prettier.io/)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/)
