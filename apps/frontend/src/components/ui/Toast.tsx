import { Toast as KobalteToast, toaster } from "@kobalte/core/toast";
import X from "lucide-solid/icons/x";
import { Portal } from "solid-js/web";
import styles from "./Toast.module.css";

export { toaster };

export function Toaster() {
  return (
    <Portal>
      <KobalteToast.Region>
        <KobalteToast.List class={styles.list} />
      </KobalteToast.Region>
    </Portal>
  );
}

type ToastVariant = "default" | "error" | "success";

type ToastProps = {
  toastId: number;
  title?: string;
  description?: string;
  variant?: ToastVariant;
};

const variantStyles: Record<ToastVariant, { container: string; progress: string; title: string }> = {
  default: {
    container: styles.default,
    progress: styles.progressDefault,
    title: styles.titleDefault,
  },
  error: {
    container: styles.error,
    progress: styles.progressError,
    title: styles.titleError,
  },
  success: {
    container: styles.success,
    progress: styles.progressSuccess,
    title: styles.titleSuccess,
  },
};

export function Toast(props: ToastProps) {
  const variant = () => props.variant ?? "default";
  const toastClass = () => {
    return [styles.toast, variantStyles[variant()].container].join(" ");
  };
  const titleClass = () => {
    return [styles.title, variantStyles[variant()].title].join(" ");
  };
  const progressClass = () => {
    return [styles.progressFill, variantStyles[variant()].progress].join(" ");
  };

  return (
    <KobalteToast toastId={props.toastId} class={toastClass()}>
      <div class={styles.contentRow}>
        <div class={styles.body}>
          {props.title && (
            <KobalteToast.Title class={titleClass()}>
              {props.title}
            </KobalteToast.Title>
          )}
          {props.description && (
            <KobalteToast.Description class={styles.description}>
              {props.description}
            </KobalteToast.Description>
          )}
        </div>
        <KobalteToast.CloseButton class={styles.closeButton}>
          <X size={14} class={styles.closeIcon} />
        </KobalteToast.CloseButton>
      </div>
      <KobalteToast.ProgressTrack class={styles.progressTrack}>
        <KobalteToast.ProgressFill
          class={progressClass()}
          style={{ width: "var(--kb-toast-progress-fill-width)" }}
        />
      </KobalteToast.ProgressTrack>
    </KobalteToast>
  );
}

export function showToast(title: string, description?: string) {
  return toaster.show((props) => (
    <Toast toastId={props.toastId} title={title} description={description} />
  ));
}

export function showErrorToast(title: string, description?: string) {
  return toaster.show((props) => (
    <Toast toastId={props.toastId} title={title} description={description} variant="error" />
  ));
}

export function showSuccessToast(title: string, description?: string) {
  return toaster.show((props) => (
    <Toast toastId={props.toastId} title={title} description={description} variant="success" />
  ));
}
