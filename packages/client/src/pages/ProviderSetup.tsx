import { useEffect, useState } from 'react';
import { Provider, PublicProvider } from '@chat-group/shared';
import { api } from '../api';

export function ProviderSetup() {
  const [providers, setProviders] = useState<PublicProvider[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Partial<Provider>>({});
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = async () => {
    try {
      setProviders(await api.listProviders());
    } catch (e: any) {
      setError(e.message || '加载站点失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const resetEditor = () => {
    setEditing({});
    setError('');
  };

  const save = async () => {
    const name = editing.name?.trim();
    const baseUrl = editing.baseUrl?.trim();
    const apiKey = editing.apiKey?.trim();
    const isEditing = Boolean(editing.id);
    if (!name || !baseUrl || (!isEditing && !apiKey)) {
      setError(isEditing ? '名称和 Base URL 必填' : '名称、Base URL、API Key 必填');
      return;
    }

    try {
      if (isEditing && editing.id) {
        await api.updateProvider(editing.id, {
          name,
          baseUrl,
          ...(apiKey ? { apiKey } : {}),
        });
      } else {
        await api.createProvider({ name, baseUrl, apiKey: apiKey!, models: [] });
      }
      resetEditor();
      await load();
    } catch (e: any) {
      setError(e.message || '保存站点失败');
    }
  };

  const refreshModels = async (id: string) => {
    setBusyId(id);
    try {
      const { models } = await api.fetchProviderModels(id);
      setProviders((ps) => ps.map((p) => (p.id === id ? { ...p, models } : p)));
      setError('');
    } catch (e: any) {
      setError(e.message || '刷新模型失败');
    } finally {
      setBusyId(null);
    }
  };

  const toggleEnabled = async (provider: PublicProvider) => {
    setBusyId(provider.id);
    try {
      await api.updateProvider(provider.id, { enabled: !provider.enabled });
      setProviders((ps) => ps.map((p) => (
        p.id === provider.id ? { ...p, enabled: !provider.enabled } : p
      )));
      setError('');
    } catch (e: any) {
      setError(e.message || '更新站点状态失败');
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (id: string) => {
    if (!confirm('确认删除该站点?')) return;
    setBusyId(id);
    try {
      await api.deleteProvider(id);
      if (editing.id === id) resetEditor();
      await load();
    } catch (e: any) {
      setError(e.message || '删除站点失败');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="page-stack">
      <section className="page-intro">
        <div>
          <span className="eyebrow">WORKSPACE / PROVIDERS</span>
          <h1>站点管理</h1>
          <p>集中管理 OpenAI 兼容接口和可用模型。</p>
        </div>
        <div className="metric-tile">
          <span className="metric-value">{providers.length}</span>
          <span className="metric-label">已配置站点</span>
        </div>
      </section>

      {error && <div className="alert alert-error"><span>!</span>{error}</div>}

      <div className="provider-layout">
        <section className="surface editor-panel">
          <div className="section-heading">
            <div>
              <span className="section-kicker">CONFIGURATION</span>
              <h2>{editing.id ? '编辑站点' : '添加新站点'}</h2>
            </div>
            {editing.id && <button className="button button-ghost button-small" onClick={resetEditor}>取消编辑</button>}
          </div>

          <div className="form-stack">
            <label className="field">
              <span>站点名称</span>
              <input
                value={editing.name || ''}
                onChange={(e) => setEditing((p) => ({ ...p, name: e.target.value }))}
                placeholder="例如：OpenAI 官方"
              />
            </label>
            <label className="field">
              <span>Base URL</span>
              <input
                value={editing.baseUrl || ''}
                onChange={(e) => setEditing((p) => ({ ...p, baseUrl: e.target.value }))}
                placeholder="https://api.openai.com"
              />
            </label>
            <label className="field">
              <span>API Key <small>{editing.id ? '留空以保留当前密钥' : '必填'}</small></span>
              <input
                type="password"
                value={editing.apiKey || ''}
                onChange={(e) => setEditing((p) => ({ ...p, apiKey: e.target.value }))}
                placeholder={editing.id ? '••••••••••••' : 'sk-...'}
                autoComplete="new-password"
              />
            </label>
          </div>

          <button className="button button-primary button-wide" onClick={save}>
            <span>{editing.id ? '✓' : '+'}</span>{editing.id ? '保存修改' : '添加站点'}
          </button>
        </section>

        <section className="provider-list-section">
          <div className="section-heading list-heading">
            <div>
              <span className="section-kicker">CONNECTED SERVICES</span>
              <h2>已配置站点</h2>
            </div>
            <span className="count-badge">{providers.filter((p) => p.enabled).length} 个启用</span>
          </div>

          {loading ? (
            <div className="surface empty-state"><span className="loading-dot" />正在加载站点</div>
          ) : providers.length === 0 ? (
            <div className="surface empty-state">
              <span className="empty-icon">◇</span>
              <strong>还没有站点</strong>
              <span>从左侧添加第一个模型服务。</span>
            </div>
          ) : (
            <div className="provider-grid">
              {providers.map((provider) => {
                const isBusy = busyId === provider.id;
                const isExpanded = Boolean(expanded[provider.id]);
                return (
                  <article className={`provider-card ${provider.enabled ? '' : 'is-disabled'}`} key={provider.id}>
                    <div className="provider-card-top">
                      <div className="provider-mark">{provider.name.slice(0, 1).toUpperCase()}</div>
                      <div className="provider-title">
                        <h3>{provider.name}</h3>
                        <span title={provider.baseUrl}>{provider.baseUrl}</span>
                      </div>
                      <button
                        className={`status-toggle ${provider.enabled ? 'is-on' : 'is-off'}`}
                        onClick={() => toggleEnabled(provider)}
                        disabled={isBusy}
                        title={provider.enabled ? '点击禁用站点' : '点击启用站点'}
                      >
                        <span className="status-dot" />{provider.enabled ? '启用' : '禁用'}
                      </button>
                    </div>

                    <button
                      className="model-summary"
                      onClick={() => setExpanded((e) => ({ ...e, [provider.id]: !isExpanded }))}
                    >
                      <span><strong>{provider.models.length}</strong> 个可用模型</span>
                      <span className="chevron">{isExpanded ? '⌃' : '⌄'}</span>
                    </button>

                    {isExpanded && (
                      <div className="model-list">
                        {provider.models.length === 0 ? (
                          <span className="muted">暂无模型，请刷新列表</span>
                        ) : provider.models.map((model) => <span className="model-chip" key={model}>{model}</span>)}
                      </div>
                    )}

                    <div className="provider-actions">
                      <button className="button button-ghost button-small" onClick={() => setEditing(provider)}>
                        <span>✎</span>编辑
                      </button>
                      <button className="button button-ghost button-small" onClick={() => refreshModels(provider.id)} disabled={isBusy || !provider.enabled}>
                        <span>{isBusy ? '…' : '↻'}</span>刷新模型
                      </button>
                      <button className="icon-button danger" onClick={() => remove(provider.id)} disabled={isBusy} title="删除站点" aria-label="删除站点">⌫</button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
