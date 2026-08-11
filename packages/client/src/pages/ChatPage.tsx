import { useEffect, useRef, useState, type MouseEvent } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { PublicProvider, Session } from '@chat-group/shared';
import { api, streamChat } from '../api';

interface LocalMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  providerId?: string;
  model?: string;
  streaming?: boolean;
}

export function ChatPage() {
  const [providers, setProviders] = useState<PublicProvider[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [providerId, setProviderId] = useState('');
  const [model, setModel] = useState('');
  const [messages, setMessages] = useState<LocalMessage[]>([]);
  const [input, setInput] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [sessionId, setSessionId] = useState('');
  const [streamingIds, setStreamingIds] = useState<Set<string>>(new Set());
  const [editingTitleId, setEditingTitleId] = useState<string | null>(null);
  const [editTitleValue, setEditTitleValue] = useState('');
  const [error, setError] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const sessionIdRef = useRef(sessionId);
  const abortsRef = useRef<Map<string, () => void>>(new Map());
  const draftMessagesRef = useRef<Map<string, LocalMessage[]>>(new Map());

  sessionIdRef.current = sessionId;
  useEffect(() => {
    if (sessionId) localStorage.setItem('cg:lastChatSessionId', sessionId);
  }, [sessionId]);
  const currentBusy = !!sessionId && streamingIds.has(sessionId);

  const markStreaming = (id: string, active: boolean) => {
    setStreamingIds((prev) => {
      const next = new Set(prev);
      if (active) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const loadSessions = async () => {
    try {
      setSessions(await api.listChatSessions());
    } catch (e: any) {
      setError(e.message || '加载会话失败');
    }
  };

  useEffect(() => {
    api.listProviders().then((ps) => {
      setProviders(ps);
      const firstEnabled = ps.find((provider) => provider.enabled && provider.models.length > 0);
      if (firstEnabled) {
        setProviderId(firstEnabled.id);
        setModel(firstEnabled.models[0]);
      }
    }).catch((e: any) => setError(e.message || '加载站点失败'));

    (async () => {
      try {
        const list = await api.listChatSessions();
        setSessions(list);
        const lastId = localStorage.getItem('cg:lastChatSessionId');
        if (lastId && list.some((session) => session.id === lastId)) {
          const data = await api.getChatSession(lastId);
          setSessionId(lastId);
          setMessages(data.messages.map((message: any) => ({
            role: message.role,
            content: message.content,
            providerId: message.provider_id ?? message.providerId,
            model: message.model,
          })));
        }
      } catch (e: any) {
        setError(e.message || '加载会话失败');
      }
    })();
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const startSession = async (): Promise<string> => {
    const { id } = await api.createChatSession();
    setSessionId(id);
    setMessages([]);
    draftMessagesRef.current.set(id, []);
    setError('');
    setEditingTitleId(null);
    await loadSessions();
    return id;
  };

  const openSession = async (id: string) => {
    if (id === sessionId) return;
    try {
      setSessionId(id);
      setEditingTitleId(null);
      const draft = draftMessagesRef.current.get(id);
      if (draft) {
        setMessages(draft.map((message) => ({ ...message })));
      } else {
        const data = await api.getChatSession(id);
        setMessages(data.messages.map((message: any) => ({
          role: message.role,
          content: message.content,
          providerId: message.provider_id ?? message.providerId,
          model: message.model,
        })));
      }
      setError('');
    } catch (e: any) {
      setError(e.message || '打开会话失败');
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
      await api.renameChatSession(id, next);
      setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, title: next } : s)));
      cancelRename();
      await loadSessions();
    } catch (e: any) {
      setError(e.message || '重命名失败');
    }
  };

  const deleteSession = async (id: string, event?: MouseEvent) => {
    event?.preventDefault();
    event?.stopPropagation();
    if (!window.confirm('确认删除该会话?')) return;
    try {
      abortsRef.current.get(id)?.();
      abortsRef.current.delete(id);
      draftMessagesRef.current.delete(id);
      markStreaming(id, false);
      await api.deleteChatSession(id);
      setSessions((prev) => prev.filter((session) => session.id !== id));
      if (sessionId === id) {
        setSessionId('');
        setMessages([]);
        localStorage.removeItem('cg:lastChatSessionId');
      }
      if (localStorage.getItem('cg:lastChatSessionId') === id) {
        localStorage.removeItem('cg:lastChatSessionId');
      }
      await loadSessions();
    } catch (e: any) {
      setError(e.message || '删除会话失败');
    }
  };

  const send = async () => {
    if (!input.trim() || currentBusy || !providerId || !model) return;
    setError('');

    try {
      let sid = sessionId;
      if (!sid) sid = await startSession();

      const userMsg: LocalMessage = { role: 'user', content: input.trim(), providerId, model };
      const assistantMsg: LocalMessage = { role: 'assistant', content: '', providerId, model, streaming: true };
      const baseMessages = [...(draftMessagesRef.current.get(sid) || messages), userMsg, assistantMsg];
      draftMessagesRef.current.set(sid, baseMessages);
      setMessages(baseMessages.map((message) => ({ ...message })));
      setInput('');
      markStreaming(sid, true);

      const patchDraft = (updater: (ms: LocalMessage[]) => void) => {
        const current = draftMessagesRef.current.get(sid) || [];
        const copy = current.map((message) => ({ ...message }));
        updater(copy);
        draftMessagesRef.current.set(sid, copy);
        if (sessionIdRef.current === sid) {
          setMessages(copy.map((message) => ({ ...message })));
        }
      };

      const abort = streamChat(sid, { providerId, model, message: userMsg.content, systemPrompt }, (event) => {
        if (event.type === 'delta') {
          patchDraft((ms) => {
            const last = ms[ms.length - 1];
            if (last?.streaming) last.content += event.content || '';
          });
        } else if (event.type === 'error') {
          patchDraft((ms) => {
            const last = ms[ms.length - 1];
            if (last?.streaming) {
              last.streaming = false;
              last.content += `\n\n[错误] ${event.message || '请求失败'}`;
            }
          });
          if (sessionIdRef.current === sid) setError(event.message || '请求失败');
        } else if (event.type === 'done') {
          patchDraft((ms) => {
            const last = ms[ms.length - 1];
            if (last?.streaming) last.streaming = false;
          });
          void loadSessions();
        } else if (event.type === 'settled') {
          markStreaming(sid, false);
          abortsRef.current.delete(sid);
          // Keep final draft until next open reloads from DB if needed
        }
      });

      abortsRef.current.set(sid, abort);
    } catch (e: any) {
      setError(e.message || '发送失败');
      if (sessionId) markStreaming(sessionId, false);
    }
  };

  const activeProvider = providers.find((provider) => provider.id === providerId);

  return (
    <div className="chat-layout">
      <aside className="session-sidebar">
        <div className="session-sidebar-header">
          <strong>会话记录</strong>
          <button className="new-session" onClick={() => void startSession()} title="新建会话" aria-label="新建会话">+</button>
        </div>
        <div className="session-list">
          {sessions.length === 0 && <span className="muted">还没有历史会话</span>}
          {sessions.map((session) => (
            <div
              className={`session-item ${sessionId === session.id ? 'is-active' : ''} ${streamingIds.has(session.id) ? 'is-streaming' : ''}`}
              key={session.id}
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
                  <button
                    type="button"
                    className="session-main"
                    onClick={() => void openSession(session.id)}
                    title={session.title}
                  >
                    <span className="session-title">{session.title || '未命名会话'}</span>
                  </button>
                  <div className="session-actions">
                    <button
                      type="button"
                      className="session-rename"
                      onClick={(event) => { event.preventDefault(); event.stopPropagation(); beginRename(session); }}
                      title="重命名"
                      aria-label="重命名"
                    >✎</button>
                    <button
                      type="button"
                      className="session-delete"
                      onClick={(event) => void deleteSession(session.id, event)}
                      title="删除会话"
                      aria-label="删除会话"
                    >×</button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      </aside>

      <section className="chat-workspace">
        <div className="workspace-heading">
          <div>
            <span className="eyebrow">CONVERSATION / SINGLE MODEL</span>
            <h1>单模型对话</h1>
            <p>选择一个模型，开始一段可持续的对话。生成中的会话不会锁死其他会话。</p>
          </div>
          {currentBusy && <span className="round-badge"><span className="online-dot" />生成中</span>}
        </div>

        {error && <div className="alert alert-error"><span>!</span>{error}</div>}

        <div className="chat-controls">
          <select
            className="control-select"
            value={providerId}
            onChange={(event) => {
              const nextId = event.target.value;
              setProviderId(nextId);
              const nextProvider = providers.find((provider) => provider.id === nextId);
              setModel(nextProvider?.models[0] || '');
            }}
          >
            <option value="">选择站点</option>
            {providers.filter((provider) => provider.enabled).map((provider) => (
              <option key={provider.id} value={provider.id}>{provider.name}</option>
            ))}
          </select>
          <select className="control-select" value={model} onChange={(event) => setModel(event.target.value)} disabled={!activeProvider}>
            <option value="">选择模型</option>
            {(activeProvider?.models || []).map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
          <input className="control-input" placeholder="系统提示词（可选）" value={systemPrompt} onChange={(event) => setSystemPrompt(event.target.value)} />
        </div>

        <div className="chat-window">
          {messages.length === 0 ? (
            <div className="chat-empty"><span className="chat-empty-icon">↗</span><strong>准备开始对话</strong><span>从上方选择站点和模型</span></div>
          ) : messages.map((message, index) => (
            <div className={`message-row ${message.role === 'user' ? 'user' : ''}`} key={`${message.role}-${index}`}>
              <div className="message-bubble">
                <span className="message-meta">{message.role === 'user' ? 'YOU' : `${message.model || 'ASSISTANT'}${message.streaming ? ' · LIVE' : ''}`}</span>
                <div className="message-content">
                  {message.streaming && !message.content ? (
                    <span className="typing"><i /><i /><i /></span>
                  ) : (
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={{
                        code: ({ className, children, ...props }: any) => className
                          ? <pre className="md-code-block"><code className={className} {...props}>{children}</code></pre>
                          : <code className="md-inline-code" {...props}>{children}</code>,
                      }}
                    >
                      {message.content}
                    </ReactMarkdown>
                  )}
                </div>
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        <div className="chat-composer">
          <textarea
            className="control-input chat-input"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void send();
              }
            }}
            placeholder={currentBusy ? '当前会话生成中，可新建或切换其他会话继续聊…' : '输入消息，Enter 发送，Shift+Enter 换行'}
            disabled={currentBusy}
          />
          <button className="button button-primary send-button" onClick={() => void send()} disabled={currentBusy || !input.trim() || !providerId || !model}>
            {currentBusy ? '生成中' : '发送'}
          </button>
        </div>
      </section>
    </div>
  );
}
