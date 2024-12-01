
# AI.ME File for AI Tools Guidance

## Purpose
This file serves as guidance for AI tools to follow when contributing to projects. It enforces coding best practices, consistency, and compliance with user-defined principles.

---

## General Guidance
1. **Code Quality**:
   - Code MUST adhere to SOLID principles:
     - **S**ingle Responsibility Principle (SRP): Each class or function should have one responsibility.
     - **O**pen-Closed Principle (OCP): Code should be open for extension, but closed for modification.
     - **L**iskov Substitution Principle (LSP): Subclasses should be replaceable without altering functionality.
     - **I**nterface Segregation Principle (ISP): No client should be forced to depend on methods it does not use.
     - **D**ependency Inversion Principle (DIP): High-level modules should not depend on low-level modules. Both should depend on abstractions.

2. **Human Readability**:
   - Write descriptive variable, function, and class names.
   - Use proper indentation and formatting.
   - Add inline comments to explain non-obvious code.
   - Provide module-level comments explaining the overall purpose and key features.

3. **Modularity**:
   - Large or complex functions must be split into smaller, more manageable functions.
   - Suggest splitting files when they grow too large or contain unrelated logic.

4. **Consistency**:
   - Follow a unified coding style (e.g., PSR-12 for PHP, ES6+ for JavaScript).
   - Avoid introducing multiple patterns unless absolutely necessary.

---

## Specific Guidelines for AI Contributions
1. **Respect Existing Code**:
   - Do not overwrite or restructure existing code unless requested or if fixing errors.
   - When making suggestions, clearly explain what is being changed and why.

2. **Modifications and Suggestions**:
   - Suggest improvements or updates, but ensure backward compatibility.
   - If a module is used by external applications, it must be usable **as is**.
   - Changes to APIs or public methods must be approved and well-documented.

3. **Error Detection**:
   - If an error is identified, prioritize fixing it over introducing new features.

4. **Testing**:
   - Include or suggest unit tests and integration tests where applicable.
   - Ensure test cases are well-documented and comprehensive.

5. **File-Specific Customizations**:
   - When working on a specific file, tailor the approach to fit the file's context and adhere to the principles above.

---

## How AI Should Use This File
- Automatically detect and apply the guidance when contributing to projects associated with this repository.
- Update the AI.ME file if additional rules or clarifications are provided during interaction.

---

## Example Application
For JavaScript files like `new_conn.js`:
- Detect the base module path dynamically using `window.location` or `document.currentScript`.
- Use centralized configuration to manage paths and avoid hardcoding.
- Split functions if they exceed 50 lines or include nested logic.

---

