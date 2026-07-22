import { useLocation, useNavigate, useParams, useSearchParams } from '@solidjs/router';
import type { TWidgetSource } from '@vibecanvas/orpc-client';
import { type Component } from 'solid-js';
import { WidgetDetailPage } from '@vibecanvas/ui-ai-chat';
import { createFrontendSidebarController, legacyActorUiCapability } from '@/ai-chat-adapters';

const WidgetPage: Component = () => {
  const params = useParams<{ source: string; name: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const controller = createFrontendSidebarController({ pathname: () => location.pathname, navigate });
  const source = (): TWidgetSource | null => params.source === 'published' || params.source === 'draft' ? params.source : null;
  const name = () => {
    try { return decodeURIComponent(params.name); } catch { return null; }
  };
  return <WidgetDetailPage
    source={source()}
    name={name()}
    controller={controller}
    legacy={legacyActorUiCapability}
    query={{
      tab: () => typeof searchParams.tab === 'string' ? searchParams.tab : undefined,
      path: () => typeof searchParams.path === 'string' ? searchParams.path : undefined,
      set: (values, options) => setSearchParams(values, options),
    }}
  />;
};

export default WidgetPage;
