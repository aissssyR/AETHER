# Steering Rules for Luvsean
1. Always use Chalk for terminal output: Magenta for headers, Green for success, Red for errors.
2. When calling Nebius AI, always request JSON output with "context_summary" and "next_steps" keys.
3. Fallback gracefully to basic git parsing if the AI API fails or times out.