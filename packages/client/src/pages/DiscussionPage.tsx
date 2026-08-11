import { useEffect, useState } from 'react';
import { PublicProvider, DiscussionTurn } from '@chat-group/shared';
import { api, streamDiscussion } from '../api';

interface ModelSelection {
  key: string;
  providerId: string;
  model: string;
}

interface DiscussionMessage {
  type: 'turn' | 'summary' | 'error' | 'user';
  round?: number;
  providerId?: string;
  model?: string;
  content: string;
  providerName?: string;
}

let keyCounter = 0;
function nextKey() { return `selection_${++keyCounter}`; }

export function DiscussionPage() {
  const [providers, setProviders] = useState<PublicProvider[]>([]);
  const [selections, setSelections] = useState<ModelSelection[]>([]);
  const [rounds, setRounds] = useState(3);
  const [prompt, setPrompt] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [running, setRunning] = useState(false);
  const [messages, setMessages] = useState<DiscussionMessage[]>([]);
  const [sessionId, setSessionId] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    api.listProviders().then(setProviders).catch((e: any) => setError(e.message || '加载站点失败'));
  }, []);

  const addSelection = () => {
    const enabledProviders = providers.filter((provider) => provider.enabled && provider.models.length > 0);
    for (const provider of enabledProviders) {
      const model = provider.models.find((item) => !selections.some((selection) => selection.providerId === provider.id && selection.model === item));
      if (model) {
        setSelections((current) => [...current, { key: nextKey(), providerId: provider.id, model }]);
        return;
      }
    }
    const first = enabledProviders[0];
    if (first) setSelections((current) => [...current, { key: nextKey(), providerId: first.id, model: first.models[0] }]);
  };

  const removeSelection = (key: string) => setSelections((current) => current.filter((item) => item.key !== key));

  const updateSelection = (key: string, field: 'providerId' | 'model', value: string) => {
    setSelections((current) => current.map((item) => {
      if (item.key !== key) return item;
      if (field === 'providerId') {
        const provider = providers.find((candidate) => candidate.id === value);
        return { ...item, providerId: value, model: provider?.models[0] || '' };
      }
      return { ...item, model: value };
    }));
  };

  const run = async () => {
    if (!prompt.trim() || running) return;
    const providerModels = selections.map(({ providerId, model }) => ({ providerId, model })).filter((item) => item.providerId && item.model);
    if (!providerModels.length) {
      setError('请至少选择一个模型');
      return;
    }

    setError('');
    setMessages([{ type: 'user', content: prompt.trim() }]);
    setRunning(true);

    try {
      let sid = sessionId;
      if (!sid) {
        const created = await api.createDiscussionSession();
        sid = created.id;
        setSessionId(sid);
      }

      streamDiscussion(
        sid,
        {
          providerModels,
          rounds,
          initialPrompt: prompt.trim(),
          systemPrompt: systemPrompt || undefined,
          maxTokensPerTurn: 400,
          temperature: 0.7,
        },
        (event) => {
          if (event.type === 'turn' && event.turn) {
            const turn = event.turn as DiscussionTurn;
            const provider = providers.find((item) => item.id === turn.providerId);
            setMessages((current) => [...current, {
              type: 'turn',
              round: turn.round,
              providerId: turn.providerId,
              model: turn.model,
              content: turn.content,
              providerName: provider?.name,
            }]);
          } else if (event.type === 'summary' && event.content) {
            setMessages((current) => [...current, { type: 'summary', content: event.content! }]);
          } else if (event.type === 'error') {
            setMessages((current) => [...current, { type: 'error', content: event.message || '讨论失败' }]);
            setError(event.message || '讨论失败');
          } else if (event.type === 'settled') {
            setRunning(false);
          }
        }
      );
    } catch (e: any) {
      setError(e.message || '讨论失败');
      setRunning(false);
    }
  };

  const enabledProviders = providers.filter((provider) => provider.enabled);

  return (
    <div className="discussion-layout">
      <section className="surface discussion-config">
        <span className="eyebrow">WORKFLOW / ROUND TABLE</span>
        <h1>多模型讨论</h1>
        <p>让多个模型围绕同一个问题依次发言，并在最后生成总结。</p>

        <div className="selection-header">
          <strong>参与模型 <span className="count-badge">{selections.length}</span></strong>
          <button className="button button-ghost button-small" onClick={addSelection} disabled={running || enabledProviders.length === 0}><span>+</span>添加模型</button>
        </div>
        <div className="selection-list">
          {selections.length === 0 && <span className="muted">还没有选择参与模型</span>}
          {selections.map((selection) => (
            <div className="selection-row" key={selection.key}>
              <select value={selection.providerId} onChange={(event) => updateSelection(selection.key, 'providerId', event.target.value)}>
                {enabledProviders.map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}
              </select>
              <select value={selection.model} onChange={(event) => updateSelection(selection.key, 'model', event.target.value)}>
                {(providers.find((provider) => provider.id === selection.providerId)?.models || []).map((model) => <option key={model} value={model}>{model}</option>)}
              </select>
              <button className="remove-selection" onClick={() => removeSelection(selection.key)} title="移除模型" aria-label="移除模型">×</button>
            </div>
          ))}
        </div>

        <div className="field discussion-field">
          <span>讨论轮数 <small>1 - 10</small></span>
          <input className="control-input" type="number" min={1} max={10} value={rounds} onChange={(event) => setRounds(Math.min(10, Math.max(1, parseInt(event.target.value, 10) || 1)))} />
        </div>
        <label className="field discussion-field">
          <span>系统提示词 <small>可选</small></span>
          <input className="control-input" value={systemPrompt} onChange={(event) => setSystemPrompt(event.target.value)} placeholder="例如：你们都是资深产品专家" />
        </label>
        <label className="field discussion-field">
          <span>讨论主题</span>
          <textarea className="discussion-prompt" value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="输入一个值得讨论的问题" />
        </label>
        <button className="button button-primary discussion-run" onClick={() => void run()} disabled={running || !prompt.trim()}>
          <span>{running ? '…' : '↗'}</span>{running ? '讨论进行中' : '开始讨论'}
        </button>
      </section>

      <section className="discussion-result">
        <div className="discussion-result-header">
          <div>
            <span className="eyebrow">LIVE TRANSCRIPT</span>
            <h1>讨论记录</h1>
          </div>
          <span className="round-badge">{rounds} 轮 · {selections.length} 模型</span>
        </div>
        {error && <div className="alert alert-error"><span>!</span>{error}</div>}
        <div className="discussion-window">
          {messages.length === 0 ? (
            <div className="discussion-empty"><div><strong>准备好开始一场讨论</strong><span>左侧配置参与模型和讨论主题</span></div></div>
          ) : messages.map((message, index) => {
            if (message.type === 'user') return <div className="discussion-message" key={index}><div className="discussion-user">{message.content}</div></div>;
            if (message.type === 'summary') return <div className="summary-card" key={index}><strong>✦ 最终总结</strong><div>{message.content}</div></div>;
            if (message.type === 'error') return <div className="discussion-error" key={index}>! {message.content}</div>;
            return (
              <div className="discussion-message" key={index}>
                <div className="turn-label">{message.providerName || message.providerId} / {message.model} · ROUND {message.round}</div>
                <div className="turn-content">{message.content}</div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
