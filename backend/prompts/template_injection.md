## ⚠️ WORKFLOW TEMPLATE PROVIDED — STRICT BLUEPRINT MODE

The user has provided a structured YAML Workflow Template below.
You MUST treat this template as the **absolute source of truth** and **strict blueprint** for the workflow.

### MANDATORY TEMPLATE RULES:
1. **Inputs → ParamNode**: Parse every `inputs` entry defined in the template.
   Map each input EXACTLY to the `parameter_block` dynamic schema with `parameter_payload`.
   Preserve the input's `name`, `type` (map to String/Number/Boolean/JSON), `default` (as defaultValue), and `required` flag.

2. **Steps → Block Mapping**: Follow the `steps` outlined in the template **chronologically**.
   Map each step to the appropriate block_type based on its `type` field:
   - `action` / `api_call` / `http` → `action_block` with `action_payload`
   - `condition` / `check` / `branch` / `if` → `conditional_block` with `conditional_payload`
   - `code` / `script` / `transform` / `compute` → `code_block` with `code_payload`
   - `notify` / `alert` / `notification` / `email` / `slack` → `notification_block` with `notify_payload`
   - `result` / `output` / `return` / `done` → `result_block` with `result_payload`
   - `parameter` / `input` / `config` → `parameter_block` with `parameter_payload`

3. **Variable Interpolation**: Ensure ALL variables are wired correctly between nodes:
   - Use `{{input_name}}` for template-defined inputs (from the `inputs` section)
   - Use `{{step_N.output_key}}` for cross-step data flow
   - Wire every `input_from` / `depends_on` / `uses` reference in the template to the correct interpolation path

4. **Rules & Constraints**: If the template includes `rules`, `constraints`, or `requirements`:
   - Obey them STRICTLY — they override any default behavior
   - Include timeout, retry, and error-handling settings as specified
   - Add conditional_block nodes for any explicit error-handling or branching rules

5. **Do not hallucinate steps**: Only generate steps that are explicitly defined in the template.
   Do NOT add extra steps, remove steps, or reorder steps unless the template explicitly instructs branching.

6. **Step metadata**: Preserve the template's step `name`/`title` as the step title,
   and use the `description` field verbatim (with {{variable}} substitution) as the step description.

### USER TEMPLATE INSTRUCTIONS:
```yaml
{template_content}
```

You MUST generate a workflow that EXACTLY follows this template. Any deviation is a failure.
