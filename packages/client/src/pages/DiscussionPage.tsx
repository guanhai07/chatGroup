import { useEffect, useRef, useState } from 'react';
import { PublicProvider, DiscussionTurn, Session } from '@chat-group/shared';
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

function mapDbMessages(rows: any[], providers: PublicProvider[]): DiscussionMessage[] {
  const result: DiscussionMessage[] = [];
  for (const row of rows) {
    const role = row.role;
    const usage = row.usage || (row.usage_json ? (typeof row.usage_json === 'string' ? JSON.parse(row.usage_json) : row.usage_json) : null);
    if (role === 'user') {
      result.push({ type: 'user', content: row.content });
      continue;
    }
    if (role === 'assistant') {
      if (usage?.kind === 'summary' || row.model === '__summary__') {
        result.push({ type: 'summary', content: row.content });
        continue;
      }
      const providerId = row.provider_id ?? row.providerId;
      const provider = providers.find((item) => item.id === providerId);
      result.push({
        type: 'turn',
        round: row.round ?? undefined,
        providerId,
        model: row.model,
        content: row.content,
        providerName: provider?.name,
      });
    }
  }

  // Legacy data: summary was saved as the last assistant turn with a higher round number.
  const turns = result.filter((item) => item.type === 'turn');
  if (turns.length >= 2) {
    const lastIndex = result.length - 1;
    const last = result[lastIndex];
    if (last?.type === 'turn') {
      const earlierMax = Math.max(...turns.slice(0, -1).map((item) => item.round || 0), 0);
      if ((last.round || 0) > earlierMax) {
        result[lastIndex] = { type: 'summary', content: last.content };
      }
    }
  }
  return result;
}

export function DiscussionPage() {
  const [providers, setProviders] = useState<PublicProvider[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selections, setSelections] = useState<ModelSelection[]>([]);
  const [rounds, setRounds] = useState(3);
  const [prompt, setPrompt] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [runningIds, setRunningIds] = useState<Set<string>>(new Set());
  const [messages, setMessages] = useState<DiscussionMessage[]>([]);
  const [sessionId, setSessionId] = useState('');
  const [editingTitleId, setEditingTitleId] = useState<string | null>(null);
  const [editTitleValue, setEditTitleValue] = useState('');
  const [error, setError] = useState('');
  const sessionIdRef = useRef(sessionId);
  const draftRef = useRef<Map<string, DiscussionMessage[]>>(new Map());
  const abortsRef = useRef<Map<string, () => void>>(new Map());

  sessionIdRef.current = sessionId;
  useEffect(() => {
    if (sessionId) localStorage.setItem('cg:lastDiscussionSessionId', sessionId);
  }, [sessionId]);
  const running = !!sessionId && runningIds.has(sessionId);

  const markRunning = (id: string, active: boolean) => {
    setRunningIds((prev) => {
      const next = new Set(prev);
      if (active) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const loadSessions = async () => {
    try {
      setSessions(await api.listDiscussionSessions());
    } catch (e: any) {
      setError(e.message || '加载讨论历史失败');
    }
  };

  useEffect(() => {
    let cancelled = false;
    api.listProviders().then(async (list) => {
      if (cancelled) return;
      setProviders(list);
      try {
        const sessionsList = await api.listDiscussionSessions();
        if (cancelled) return;
        setSessions(sessionsList);
        const lastId = localStorage.getItem('cg:lastDiscussionSessionId');
        if (lastId && sessionsList.some((session) => session.id === lastId)) {
          const data = await api.getDiscussionSession(lastId);
          if (cancelled) return;
          setSessionId(lastId);
          setMessages(mapDbMessages(data.messages, list));
        }
      } catch (e: any) {
        if (!cancelled) setError(e.message || '加载讨论历史失败');
      }
    }).catch((e: any) => {
      if (!cancelled) setError(e.message || '加载站点失败');
    });
    return () => { cancelled = true; };
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

  const startSession = async (opts?: { clearPrompt?: boolean }): Promise<string> => {
    const created = await api.createDiscussionSession();
    setSessionId(created.id);
    setMessages([]);
    draftRef.current.set(created.id, []);
    if (opts?.clearPrompt) setPrompt('');
    setEditingTitleId(null);
    setError('');
    await loadSessions();
    return created.id;
  };

  const openSession = async (id: string) => {
    if (id === sessionId) return;
    try {
      setSessionId(id);
      setEditingTitleId(null);
      const draft = draftRef.current.get(id);
      if (draft) {
        setMessages(draft.map((item) => ({ ...item })));
      } else {
        const data = await api.getDiscussionSession(id);
        const mapped = mapDbMessages(data.messages, providers);
        setMessages(mapped);
      }
      setError('');
    } catch (e: any) {
      setError(e.message || '打开讨论失败');
    }
  };

  const beginRename = (session: Session) => {
    setEditingTitleId(session.id);
    setEditTitleValue(session.title || '');
  };

  const cancelRename = () => {
    setEditingTitleId(null);
    setEditTitleValue('');
  };

  const renameSession = async (id: string, title: string) => {
    const next = title.trim();
    if (!next) {
      cancelRename();
      return;
    }
    try {
      await api.renameDiscussionSession(id, next);
      setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, title: next } : s)));
      cancelRename();
      await loadSessions();
    } catch (e: any) {
      setError(e.message || '重命名失败');
    }
  };

  const deleteSession = async (id: string) => {
    if (!confirm('确认删除该讨论?')) return;
    try {
      abortsRef.current.get(id)?.();
      abortsRef.current.delete(id);
      draftRef.current.delete(id);
      markRunning(id, false);
      await api.deleteDiscussionSession(id);
      await loadSessions();
      if (sessionId === id) {
        setSessionId('');
        setMessages([]);
      }
    } catch (e: any) {
      setError(e.message || '删除讨论失败');
    }
  };

  const run = async () => {
    if (!prompt.trim() || running) return;
    const providerModels = selections.map(({ providerId, model }) => ({ providerId, model })).filter((item) => item.providerId && item.model);
    if (!providerModels.length) {
      setError('请至少选择一个模型');
      return;
    }

    setError('');

    try {
      let sid = sessionId;
      // 已有内容的历史会话上再开讨论时，新建一条记录，避免串台
      if (!sid || messages.length > 0) sid = await startSession();

      const initial: DiscussionMessage[] = [{ type: 'user', content: prompt.trim() }];
      draftRef.current.set(sid, initial);
      setMessages(initial);
      markRunning(sid, true);

      const patchDraft = (updater: (ms: DiscussionMessage[]) => void) => {
        const current = draftRef.current.get(sid) || [];
        const copy = current.map((item) => ({ ...item }));
        updater(copy);
        draftRef.current.set(sid, copy);
        if (sessionIdRef.current === sid) {
          setMessages(copy.map((item) => ({ ...item })));
        }
      };

      const abort = streamDiscussion(
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
            patchDraft((current) => {
              current.push({
                type: 'turn',
                round: turn.round,
                providerId: turn.providerId,
                model: turn.model,
                content: turn.content,
                providerName: provider?.name,
              });
            });
          } else if (event.type === 'summary' && event.content) {
            patchDraft((current) => {
              current.push({ type: 'summary', content: event.content! });
            });
          } else if (event.type === 'error') {
            patchDraft((current) => {
              current.push({ type: 'error', content: event.message || '讨论失败' });
            });
            if (sessionIdRef.current === sid) setError(event.message || '讨论失败');
          } else if (event.type === 'done') {
            void loadSessions();
          } else if (event.type === 'settled') {
            markRunning(sid, false);
            abortsRef.current.delete(sid);
          }
        }
      );
      abortsRef.current.set(sid, abort);
    } catch (e: any) {
      setError(e.message || '讨论失败');
      if (sessionId) markRunning(sessionId, false);
    }
  };

  const enabledProviders = providers.filter((provider) => provider.enabled);

  return (
    <div className="discussion-layout">
      <aside className="session-sidebar">
        <div className="session-sidebar-header">
          <strong>讨论历史</strong>
          <button className="new-session" onClick={() => void startSession({ clearPrompt: true })} title="新建讨论" aria-label="新建讨论">+</button>
        </div>
        <div className="session-list">
          {sessions.length === 0 && <span className="muted">还没有讨论记录</span>}
          {sessions.map((session) => (
            <div
              className={`session-item ${sessionId === session.id ? 'is-active' : ''} ${runningIds.has(session.id) ? 'is-streaming' : ''}`}
              key={session.id}
              onClick={() => { if (editingTitleId !== session.id) void openSession(session.id); }}
              role="button"
              tabIndex={0}
              onKeyDown={(event) => { if (event.key === 'Enter') void openSession(session.id); }}
            >
              {editingTitleId === session.id ? (
                <input
                  className="session-edit"
                  value={editTitleValue}
                  onChange={(event) => setEditTitleValue(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      event.stopPropagation();
                      void renameSession(session.id, editTitleValue);
                    }
                    if (event.key === 'Escape') {
                      event.preventDefault();
                      event.stopPropagation();
                      cancelRename();
                    }
                  }}
                  onBlur={() => void renameSession(session.id, editTitleValue)}
                  onClick={(event) => event.stopPropagation()}
                  autoFocus
                />
              ) : (
                <>
                  <span className="session-title" title={session.title}>{session.title || '未命名讨论'}</span>
                  <div className="session-actions">
                    <button
                      className="session-rename"
                      onClick={(event) => { event.stopPropagation(); beginRename(session); }}
                      title="重命名"
                      aria-label="重命名"
                    >✎</button>
                    <button
                      className="session-delete"
                      onClick={(event) => { event.stopPropagation(); void deleteSession(session.id); }}
                      title="删除讨论"
                      aria-label="删除讨论"
                    >×</button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      </aside>

      <div className="discussion-main">
        <section className="surface discussion-config">
          <span className="eyebrow">DISCUSSION / MULTI MODEL</span>
          <h1>多模型讨论</h1>
          <p>选择多个模型轮流发言。历史会保存在左侧，切换菜单后也可恢复。</p>

          <div className="selection-header">
            <strong>参与模型</strong>
            <button className="button button-ghost" onClick={addSelection} type="button">+ 添加</button>
          </div>
          <div className="selection-list">
            {selections.length === 0 && <span className="muted">点击添加，选择要参与讨论的模型</span>}
            {selections.map((selection) => {
              const provider = providers.find((item) => item.id === selection.providerId);
              return (
                <div className="selection-row" key={selection.key}>
                  <select value={selection.providerId} onChange={(event) => updateSelection(selection.key, 'providerId', event.target.value)}>
                    {enabledProviders.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                  </select>
                  <select value={selection.model} onChange={(event) => updateSelection(selection.key, 'model', event.target.value)}>
                    {(provider?.models || []).map((item) => <option key={item} value={item}>{item}</option>)}
                  </select>
                  <button className="remove-selection" onClick={() => removeSelection(selection.key)} type="button" aria-label="移除">×</button>
                </div>
              );
            })}
          </div>

          <label className="field discussion-field">
            <span>轮数</span>
            <input type="number" min={1} max={10} value={rounds} onChange={(event) => setRounds(Number(event.target.value) || 1)} />
          </label>
          <label className="field discussion-field">
            <span>系统提示词（可选）</span>
            <input value={systemPrompt} onChange={(event) => setSystemPrompt(event.target.value)} placeholder="给所有模型的共同约束" />
          </label>
          <label className="field discussion-field">
            <span>讨论主题</span>
            <textarea className="discussion-prompt" value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="输入一个值得讨论的问题" disabled={running} />
          </label>
          <button className="button button-primary discussion-run" onClick={() => void run()} disabled={running || !prompt.trim()}>
            {running ? '讨论进行中…' : '开始讨论'}
          </button>
          {error && <div className="alert alert-error" style={{ marginTop: 12 }}><span>!</span>{error}</div>}
        </section>

        <section className="discussion-result">
          <div className="discussion-result-header">
            <div>
              <span className="eyebrow">LIVE BOARD</span>
              <h1>讨论过程</h1>
            </div>
            {running && <span className="round-badge"><span className="online-dot" />进行中</span>}
          </div>
          <div className="discussion-window">
            {messages.length === 0 ? (
              <div className="discussion-empty"><div><strong>准备好开始一场讨论</strong><span>左侧可恢复历史，中间配置模型与主题</span></div></div>
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
    </div>
  );
}
