import { useEffect, useRef, useState } from 'react';
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
  const [busy, setBusy] = useState(false);
  const [editingTitleId, setEditingTitleId] = useState<string | null>(null);
  const [editTitleValue, setEditTitleValue] = useState('');
  const [error, setError] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

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
    void loadSessions();
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const startSession = async (): Promise<string> => {
    const { id } = await api.createChatSession();
    setSessionId(id);
    setMessages([]);
    await loadSessions();
    return id;
  };

  const openSession = async (id: string) => {
    try {
      setSessionId(id);
      const data = await api.getChatSession(id);
      setMessages(data.messages.map((message: any) => ({
        role: message.role,
        content: message.content,
        providerId: message.provider_id,
        model: message.model,
      })));
      setError('');
    } catch (e: any) {
      setError(e.message || '打开会话失败');
    }
  };

  const renameSession = async (id: string, title: string) => {
    if (!title.trim()) return;
    try {
      await api.renameChatSession(id, title.trim());
      setEditingTitleId(null);
      await loadSessions();
    } catch (e: any) {
      setError(e.message || '重命名失败');
    }
  };

  const deleteSession = async (id: string) => {
    if (!confirm('确认删除该会话?')) return;
    try {
      await api.deleteChatSession(id);
      await loadSessions();
      if (sessionId === id) {
        setSessionId('');
        setMessages([]);
      }
    } catch (e: any) {
      setError(e.message || '删除会话失败');
    }
  };

  const send = async () => {
    if (!input.trim() || busy || !providerId || !model) return;
    setError('');
    setBusy(true);

    try {
      let sid = sessionId;
      if (!sid) sid = await startSession();

      const userMsg: LocalMessage = { role: 'user', content: input.trim(), providerId, model };
      const assistantMsg: LocalMessage = { role: 'assistant', content: '', providerId, model, streaming: true };
      setMessages((ms) => [...ms, userMsg, assistantMsg]);
      setInput('');

      streamChat(sid, { providerId, model, message: userMsg.content, systemPrompt }, (event) => {
        if (event.type === 'delta') {
          setMessages((ms) => {
            const copy = [...ms];
            const last = copy[copy.length - 1];
            if (last?.streaming) last.content += event.content || '';
            return copy;
          });
        } else if (event.type === 'error') {
          setMessages((ms) => {
            const copy = [...ms];
            const last = copy[copy.length - 1];
            if (last?.streaming) {
              last.streaming = false;
              last.content += `\n\n[错误] ${event.message || '请求失败'}`;
            }
            return copy;
          });
          setBusy(false);
          setError(event.message || '请求失败');
        } else if (event.type === 'done') {
          setMessages((ms) => {
            const copy = [...ms];
            const last = copy[copy.length - 1];
            if (last?.streaming) last.streaming = false;
            return copy;
          });
          setBusy(false);
          void loadSessions();
        }
      });
    } catch (e: any) {
      setBusy(false);
      setError(e.message || '发送失败');
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
              className={`session-item ${sessionId === session.id ? 'is-active' : ''}`}
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
                    if (event.key === 'Enter') { event.stopPropagation(); void renameSession(session.id, editTitleValue); }
                    if (event.key === 'Escape') setEditingTitleId(null);
                  }}
                  onBlur={() => void renameSession(session.id, editTitleValue)}
                  onClick={(event) => event.stopPropagation()}
                  autoFocus
                />
              ) : (
                <span
                  className="session-title"
                  onDoubleClick={(event) => { event.stopPropagation(); setEditingTitleId(session.id); setEditTitleValue(session.title); }}
                  title="双击重命名"
                >{session.title}</span>
              )}
              <button className="session-delete" onClick={(event) => { event.stopPropagation(); void deleteSession(session.id); }} title="删除会话" aria-label="删除会话">×</button>
            </div>
          ))}
        </div>
      </aside>

      <section className="chat-workspace">
        <div className="workspace-heading">
          <div>
            <span className="eyebrow">CONVERSATION / SINGLE MODEL</span>
            <h1>单模型对话</h1>
            <p>选择一个模型，开始一段可持续的对话。</p>
          </div>
          {busy && <span className="round-badge"><span className="online-dot" />生成中</span>}
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
            {providers.filter((provider) => provider.enabled).map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}
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
                          ? <pre><code className={className} {...props}>{children}</code></pre>
                          : <code {...props}>{children}</code>,
                        a: ({ href, children }: any) => <a href={href} target="_blank" rel="noreferrer">{children}</a>,
                      }}
                    >{message.content || ' '}</ReactMarkdown>
                  )}
                </div>
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        <div className="chat-composer">
          <textarea
            className="chat-input"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send(); } }}
            placeholder="输入消息，Enter 发送，Shift+Enter 换行"
            disabled={busy}
          />
          <button className="button button-primary send-button" onClick={() => void send()} disabled={busy || !providerId || !model}>
            <span>{busy ? '…' : '↑'}</span>{busy ? '生成中' : '发送'}
          </button>
        </div>
      </section>
    </div>
  );
}
