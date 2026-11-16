# Luvsean Project Specification
## Goal
Build a CLI tool that saves developer context using Git parsing and Nebius AI, and resurrects it with actionable next steps.
## Core Commands
- `luvsean coffin "message"`: Captures git diff, sends to Nebius AI, generates COFFIN.md.
- `luvsean resurrect`: Reads COFFIN.md, displays spooky ASCII art and AI-generated next steps.
## Tech Stack
Node.js, TypeScript, Commander.js, Chalk, Nebius AI (Nemotron model).