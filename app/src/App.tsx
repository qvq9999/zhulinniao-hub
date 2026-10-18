import { Navigate, Route, Routes } from 'react-router-dom';
import { LoaderCircle } from 'lucide-react';
import Overview from './pages/Overview';
import Sound from './pages/Sound';
import Mic from './pages/Mic';
import Device from './pages/Device';
import CloseConfirm from './components/CloseConfirm';
import { useDevice } from './device/DeviceContext';
import { ThemeSync } from './state/theme';

/**
 * 路由 — 首次打开直接进入概览（原「设备连接检测」页已按用户要求移除）。
 * 设备真实状态由 DeviceContext 持续监听：扫描中显示占位（避免闪跳），
 * 之后各页自行展示真实读数；未检出设备时端点相关区域显示真实失败原因，不假装生效。
 *
 * CloseConfirm 挂在路由之外：扫描阶段点 × 也要能弹出询问窗。
 * ThemeSync 同样挂在路由之外：主题是全局设置，不能随页面挂载/卸载而失效
 * （曾导致「选深色后重新进入设置页变回浅色」）。
 */
export default function App() {
  const { status } = useDevice();

  return (
    <>
      <ThemeSync />
      <CloseConfirm />
      {status === 'scanning' ? (
        <div className="gate-loading" role="status" aria-label="正在检测设备">
          <LoaderCircle size={28} strokeWidth={1.5} className="gate-loading__icon" />
          <p>正在检测朱雀耳机…</p>
        </div>
      ) : (
        <Routes>
          <Route path="/" element={<Navigate to="/overview" replace />} />
          <Route path="/overview" element={<Overview />} />
          <Route path="/sound" element={<Sound />} />
          <Route path="/mic" element={<Mic />} />
          <Route path="/device" element={<Device />} />
          <Route path="*" element={<Navigate to="/overview" replace />} />
        </Routes>
      )}
    </>
  );
}
