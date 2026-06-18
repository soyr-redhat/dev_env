#!/usr/bin/env node
import { readFileSync } from 'fs';
import yaml from 'js-yaml';

const BOILERPLATE_ENV = new Set(['USER', 'HOME', 'TORCHINDUCTOR_CACHE_DIR']);

const PROVIDER_MAP = {
  google: 'Google',
  redhatai: 'Red Hat AI',
  meta: 'Meta',
  'meta-llama': 'Meta',
  mistralai: 'Mistral AI',
  microsoft: 'Microsoft',
  ibm: 'IBM',
};

const PRECISION_PATTERNS = [
  [/fp8/i, 'fp8'],
  [/nvfp4/i, 'nvfp4'],
  [/fp4/i, 'fp4'],
  [/int4/i, 'int4'],
  [/int8/i, 'int8'],
  [/awq/i, 'awq'],
  [/gptq/i, 'gptq'],
  [/fp16/i, 'fp16'],
];

const VRAM_FROM_GPU = {
  'NVIDIA-H100-80GB-HBM3': 80,
  'NVIDIA-A100-SXM4-80GB': 80,
  'NVIDIA-A100-SXM4-40GB': 40,
  'NVIDIA-A100-PCIE-40GB': 40,
  'NVIDIA-A10G': 24,
  'NVIDIA-L4': 24,
  'NVIDIA-L40S': 48,
};

const TASK_MAP = {
  'text-generation': 'text',
  'text2text-generation': 'text',
  'conversational': 'text',
  'image-text-to-text': 'multimodal',
  'visual-question-answering': 'multimodal',
  'any-to-any': 'multimodal',
  'feature-extraction': 'embedding',
  'sentence-similarity': 'embedding',
};

function titleCase(str) {
  return str
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\b(It|Of|And|The|In|On|At|For)\b/g, (w) => w.toLowerCase())
    .replace(/\b(\d+[bBmM])\b/g, (w) => w.toUpperCase())
    .replace(/^./, (c) => c.toUpperCase());
}

function inferProvider(org) {
  const key = org.toLowerCase();
  return PROVIDER_MAP[key] || titleCase(org);
}

function inferPrecision(modelId) {
  for (const [pattern, precision] of PRECISION_PATTERNS) {
    if (pattern.test(modelId)) return precision;
  }
  return 'bf16';
}

function inferParams(modelId) {
  const match = modelId.match(/(\d+\.?\d*)\s*[bB]\b/);
  return match ? `${match[1]}B` : null;
}

function inferActiveParams(modelId) {
  const active = modelId.match(/[aA](\d+\.?\d*)[bB]/);
  if (active) return `${active[1]}B`;
  return null;
}

function inferVram(nodeSelector) {
  if (!nodeSelector) return 80;
  const gpu = nodeSelector['nvidia.com/gpu.product'];
  return (gpu && VRAM_FROM_GPU[gpu]) || 80;
}

function formatParamCount(total) {
  if (!total) return null;
  const billions = total / 1e9;
  if (billions >= 1) {
    const rounded = Math.round(billions * 10) / 10;
    return rounded % 1 === 0 ? `${rounded}B` : `${rounded}B`;
  }
  const millions = total / 1e6;
  return `${Math.round(millions)}M`;
}

function inferArchitecture(architectures, modelType) {
  const combined = [...(architectures || []), modelType || ''].join(' ').toLowerCase();
  if (/moe|mixture/i.test(combined)) return 'moe';
  return 'dense';
}

function extractDescription(readmeText) {
  if (!readmeText) return null;
  let text = readmeText;
  if (text.startsWith('---')) {
    const endIdx = text.indexOf('---', 3);
    if (endIdx !== -1) text = text.slice(endIdx + 3);
  }
  text = text.trim();
  const lines = text.split('\n');
  const paragraphLines = [];
  let foundContent = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!foundContent) {
      if (trimmed.startsWith('#') || trimmed === '') continue;
      if (/^<[^>]+>/.test(trimmed)) continue;
      if (/^!\[/.test(trimmed)) continue;
      if (/^>\s*\[!/.test(trimmed)) continue;
      foundContent = true;
    }
    if (foundContent) {
      if (trimmed === '' && paragraphLines.length > 0) break;
      if (trimmed.startsWith('#')) break;
      if (/^<[^>]+>/.test(trimmed) && paragraphLines.length === 0) continue;
      paragraphLines.push(trimmed);
    }
  }
  let desc = paragraphLines.join(' ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^>\s*/gm, '')
    .trim();
  if (desc.length > 150) {
    desc = desc.slice(0, 147).replace(/\s+\S*$/, '') + '...';
  }
  return desc || null;
}

async function fetchHuggingFaceMetadata(modelId) {
  try {
    const [apiRes, readmeRes] = await Promise.all([
      fetch(`https://huggingface.co/api/models/${modelId}`, {
        redirect: 'follow',
        signal: AbortSignal.timeout(10000),
      }),
      fetch(`https://huggingface.co/${modelId}/resolve/main/README.md`, {
        redirect: 'follow',
        signal: AbortSignal.timeout(10000),
      }),
    ]);

    const hf = apiRes.ok ? await apiRes.json() : null;
    const readme = readmeRes.ok ? await readmeRes.text() : null;

    if (!hf) return null;

    return {
      pipelineTag: hf.pipeline_tag,
      architectures: hf.config?.architectures,
      modelType: hf.config?.model_type,
      totalParams: hf.safetensors?.total,
      maxPositionEmbeddings: hf.config?.max_position_embeddings
        || hf.config?.text_config?.max_position_embeddings,
      description: extractDescription(readme),
    };
  } catch {
    return null;
  }
}

async function convert(input) {
  const docs = yaml.loadAll(input);
  const pod = docs.find(
    (d) => d && (d.kind === 'Pod' || d.kind === 'Deployment')
  );
  if (!pod) {
    throw new Error('No Pod or Deployment resource found in input');
  }

  const spec =
    pod.kind === 'Deployment'
      ? pod.spec?.template?.spec
      : pod.spec;

  const container = spec?.containers?.[0];
  if (!container) throw new Error('No container found in pod spec');

  const allArgs = container.args || [];
  let modelId = null;
  const vllmArgs = [];

  for (let i = 0; i < allArgs.length; i++) {
    const arg = allArgs[i];
    if (arg === '--model' && i + 1 < allArgs.length) {
      modelId = allArgs[++i];
    } else if (arg.startsWith('--model=')) {
      modelId = arg.split('=')[1];
    } else if (arg === '--port' && i + 1 < allArgs.length) {
      i++;
    } else if (arg.startsWith('--port=')) {
      // skip
    } else if (arg.startsWith('--')) {
      if (i + 1 < allArgs.length && !allArgs[i + 1].startsWith('--')) {
        vllmArgs.push(`${arg}=${allArgs[++i]}`);
      } else {
        vllmArgs.push(arg);
      }
    }
  }

  if (!modelId) throw new Error('Could not find --model argument');

  const [org, ...repoParts] = modelId.split('/');
  const repo = repoParts.join('/');

  const envVars = {};
  if (container.env) {
    for (const e of container.env) {
      if (!BOILERPLATE_ENV.has(e.name)) {
        envVars[e.name] = String(e.value);
      }
    }
  }

  const gpuCount =
    parseInt(container.resources?.limits?.['nvidia.com/gpu']) || 1;
  const cpu = container.resources?.requests?.cpu || '4';
  const memory = container.resources?.requests?.memory || '32Gi';

  const nodeSelector = spec.nodeSelector || null;

  let shmSize = null;
  if (spec.volumes) {
    const shm = spec.volumes.find(
      (v) => v.emptyDir?.medium === 'Memory'
    );
    if (shm?.emptyDir?.sizeLimit) shmSize = shm.emptyDir.sizeLimit;
  }

  const precision = inferPrecision(modelId);

  let contextLength = 8192;
  for (const arg of vllmArgs) {
    const match = arg.match(/--max-model-len=(\d+)/);
    if (match) contextLength = parseInt(match[1]);
  }

  const hf = await fetchHuggingFaceMetadata(modelId);

  const paramCount = formatParamCount(hf?.totalParams) || inferParams(repo) || 'TODO';
  const activeParams = inferActiveParams(repo) || paramCount;
  const task = (hf?.pipelineTag && TASK_MAP[hf.pipelineTag]) || 'text';
  const architecture = hf ? inferArchitecture(hf.architectures, hf.modelType) : 'dense';
  if (hf?.maxPositionEmbeddings) contextLength = hf.maxPositionEmbeddings;

  const recipe = {
    meta: {
      title: titleCase(repo),
      provider: inferProvider(org),
      description: hf?.description || 'TODO: Add model description',
      date_updated: new Date().toISOString().split('T')[0],
      tasks: [task],
    },
    model: {
      model_id: modelId,
      architecture,
      parameter_count: paramCount,
      active_parameters: activeParams,
      context_length: contextLength,
    },
    variants: {
      default: {
        precision,
        min_gpus: gpuCount,
        vram_minimum_gb: inferVram(nodeSelector),
        description: 'TODO: Add variant description',
      },
    },
    deployment: {
      image: container.image,
    },
  };

  if (vllmArgs.length > 0) recipe.deployment.vllm_args = vllmArgs;
  if (Object.keys(envVars).length > 0) recipe.deployment.env = envVars;

  recipe.deployment.resources = { gpu: gpuCount, cpu, memory };

  if (nodeSelector) recipe.deployment.node_selector = nodeSelector;
  if (shmSize) recipe.deployment.shm_size = shmSize;

  return yaml.dump(recipe, {
    lineWidth: -1,
    quotingType: '"',
    forceQuotes: false,
    noRefs: true,
    sortKeys: false,
  });
}

const input = readFileSync(process.argv[2] || '/dev/stdin', 'utf8');
process.stdout.write(await convert(input));
