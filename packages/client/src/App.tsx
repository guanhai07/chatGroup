import { useState } from 'react';
import { ProviderSetup } from './pages/ProviderSetup';
import { ChatPage } from './pages/ChatPage';
import { DiscussionPage } from './pages/DiscussionPage';

type Page = 'providers' | 'chat' | 'discussion';

export default function App() {
  const [page, setPage] = useState<Page>('providers');

  const navigation = [
    { id: 'providers' as const, icon: '⌂', label: '站点管理', note: '服务与模型' },
    { id: 'chat' as const, icon: '↗', label: '单模型对话', note: '连续会话' },
    { id: 'discussion' as const, icon: '◎', label: '多模型讨论', note: '轮流协作' },
  ];

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true"><span className="brand-c">C</span><span className="brand-g">G</span></div>
          <div><strong>Chat Group</strong><small>LOCAL AI WORKSPACE</small></div>
        </div>
        <div className="sidebar-label">工作区</div>
        <nav className="main-nav" aria-label="主导航">
          {navigation.map((item) => (
            <button
              className={`nav-item ${page === item.id ? 'is-active' : ''}`}
              key={item.id}
              onClick={() => setPage(item.id)}
            >
              <span className="nav-icon">{item.icon}</span>
              <span className="nav-copy"><strong>{item.label}</strong><small>{item.note}</small></span>
              {page === item.id && <span className="nav-arrow">›</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <span className="online-dot" />本地服务已就绪
          <small>数据保存在本机 SQLite</small>
        </div>
      </aside>

      <div className="main-column">
        <header className="topbar">
          <div className="breadcrumb"><span>CHAT GROUP</span><i>/</i>{navigation.find((item) => item.id === page)?.label}</div>
          <div className="topbar-meta"><span className="topbar-dot" />LOCAL MODE</div>
        </header>
        <main className="content-area">
          {page === 'providers' && <ProviderSetup />}
          {page === 'chat' && <ChatPage />}
          {page === 'discussion' && <DiscussionPage />}
        </main>
      </div>
    </div>
  );
}
