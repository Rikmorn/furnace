import type { FrameInfo, FrameLoopHandle } from "@furnace/core/frame";
import * as frame from "@furnace/core/frame";
import type { Context } from "@furnace/core/gpu";
import * as gpu from "@furnace/core/gpu";
import { type Component, mount, unmount } from "svelte";
import type { DemoHelp } from "./help-types.ts";
import { subscribeOverlay } from "./stats-state.svelte.ts";
import Breadcrumb from "./ui/Breadcrumb.svelte";
import ControlsPanel from "./ui/ControlsPanel.svelte";
import HelpPanel from "./ui/HelpPanel.svelte";
import StatsPanel from "./ui/StatsPanel.svelte";

export type MountDemoOptions<
  Scene,
  ControlsProps extends Record<string, unknown> = Record<string, never>,
> = {
  /** The DemoHelp for this demo. */
  help: DemoHelp;
  /** Optional Svelte component rendering the controls panel body. */
  controls?: Component<ControlsProps>;
  /** Props to pass into the controls component (if any). */
  controlsProps?: ControlsProps;
  /** Build scene resources once the ctx is ready. */
  setup: (ctx: Context) => Promise<{ scene: Scene; dispose?: () => void }>;
  /** Called every frame. */
  frame: (args: { ctx: Context; scene: Scene; info: FrameInfo }) => void;
};

type ChromeHosts = {
  breadcrumb: HTMLElement;
  stats: HTMLElement;
  help: HTMLElement;
  controls: HTMLElement;
};

function getSlug(): string {
  const path = window.location.pathname.replace(/^\/+|\/+$/g, "");
  return path || "index";
}

function requireCanvas(): HTMLCanvasElement {
  const canvas = document.querySelector<HTMLCanvasElement>("#gpu");
  if (!canvas) throw new Error("[furnace/cookbook] canvas#gpu not found");
  return canvas;
}

function requireChromeHosts(): ChromeHosts {
  const breadcrumb = document.querySelector<HTMLElement>("#breadcrumb");
  const stats = document.querySelector<HTMLElement>("#stats");
  const help = document.querySelector<HTMLElement>("#help");
  const controls = document.querySelector<HTMLElement>("#controls");
  if (!breadcrumb || !stats || !help || !controls) {
    throw new Error("[furnace/cookbook] missing chrome slot in HTML");
  }
  return { breadcrumb, stats, help, controls };
}

export async function mountDemo<
  Scene,
  ControlsProps extends Record<string, unknown> = Record<string, never>,
>(opts: MountDemoOptions<Scene, ControlsProps>): Promise<void> {
  const slug = getSlug();
  const canvas = requireCanvas();
  const ctx = await gpu.requestContext(canvas);

  const unsubStats = subscribeOverlay(ctx);
  const hosts = requireChromeHosts();

  const breadcrumbApp = mount(Breadcrumb, {
    target: hosts.breadcrumb,
    props: { slug },
  });
  const statsApp = mount(StatsPanel, {
    target: hosts.stats,
    props: { slug },
  });
  const helpApp = mount(HelpPanel, {
    target: hosts.help,
    props: { slug, help: opts.help },
  });
  const bodyProps: Record<string, unknown> = opts.controlsProps ?? {};
  const controlsApp = opts.controls
    ? mount(ControlsPanel, {
        target: hosts.controls,
        props: {
          slug,
          body: opts.controls,
          bodyProps,
        },
      })
    : null;

  let userDispose: (() => void) | undefined;
  let handle: FrameLoopHandle | undefined;

  const cleanup = (): void => {
    if (handle) handle.stop();
    if (userDispose) userDispose();
    unsubStats();
    unmount(breadcrumbApp);
    unmount(statsApp);
    unmount(helpApp);
    if (controlsApp) unmount(controlsApp);
    gpu.dispose(ctx);
  };
  window.addEventListener("beforeunload", cleanup, { once: true });

  try {
    const setupResult = await opts.setup(ctx);
    userDispose = setupResult.dispose;
    handle = frame.loop(ctx, (info) => {
      opts.frame({ ctx, scene: setupResult.scene, info });
    });
  } catch (e) {
    cleanup();
    throw e;
  }
}
