# devenv

Development environment for ML quantization and evaluation on OpenShift AI clusters.

## Setup

```bash
# Clone to home directory
git clone https://github.com/sawyerbowman/devenv.git ~/devenv

# Run one-time setup (clones repos, installs uv, creates venvs)
bash ~/devenv/.one_time_setup

# Source the profile (add to your ~/.bashrc)
echo 'source ~/devenv/.bash_profile' >> ~/.bashrc
```

## Structure

```
.bash_profile      # Shell config, aliases, helpers
.one_time_setup    # Idempotent first-run script
deployments/       # OpenShift/K8s manifests (lm-eval jobs, serving configs)
scripts/           # Helper scripts (quantize, eval, deploy)
other_files/       # Supplementary configs (tmux, debugpy, etc.)
```

## Venvs

- `quant` — llm-compressor, compressed-tensors, quantization work
- `eval` — lm-eval, vllm, evaluation runs
- `deploy` — vllm serving, OpenShift AI model deployment
