import { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { BoxGeometry, Color, EdgesGeometry, type Group, type LineBasicMaterial } from "three";

/* Attack Lab header: a small wireframe glass cube that pulses lime once for each newly blocked attack. */

const LIME = new Color("#C6F432");
const IDLE = new Color("#7d8a5a");
const PULSE_SECONDS = 0.6;
const PULSE_GAP_SECONDS = 0.22;

function Cube({ pulses }: { pulses: number }) {
  const group = useRef<Group>(null);
  const edgeMaterial = useRef<LineBasicMaterial>(null);
  const seen = useRef(pulses);
  const queued = useRef(0);
  const phase = useRef(-1); // seconds into the current pulse, or -1 when idle
  const box = useMemo(() => new BoxGeometry(1.3, 1.3, 1.3), []);
  const edges = useMemo(() => new EdgesGeometry(box), [box]);
  useEffect(() => () => { box.dispose(); edges.dispose(); }, [box, edges]);
  useEffect(() => {
    if (pulses > seen.current) queued.current += pulses - seen.current;
    seen.current = pulses;
  }, [pulses]);
  useFrame((_, delta) => {
    const node = group.current;
    if (!node) return;
    node.rotation.x += delta * 0.35; node.rotation.y += delta * 0.5;
    if (phase.current < 0 && queued.current > 0) { queued.current -= 1; phase.current = 0; }
    let glow = 0;
    if (phase.current >= 0) {
      phase.current += delta;
      const t = phase.current / PULSE_SECONDS;
      glow = t < 1 ? Math.sin(Math.PI * t) : 0;
      if (phase.current > PULSE_SECONDS + PULSE_GAP_SECONDS) phase.current = -1;
    }
    node.scale.setScalar(1 + glow * 0.14);
    edgeMaterial.current?.color.copy(IDLE).lerp(LIME, 0.35 + glow * 0.65);
  });
  return <group ref={group}>
    <mesh geometry={box}><meshPhysicalMaterial transmission={1} roughness={0.15} thickness={0.6} ior={1.4} transparent opacity={0.55} color="#eef9d6" /></mesh>
    <lineSegments geometry={edges}><lineBasicMaterial ref={edgeMaterial} color={IDLE} /></lineSegments>
  </group>;
}

export default function CubeCanvas({ active, pulses }: { active: boolean; pulses: number }) {
  return <Canvas className="scene-canvas" dpr={[1, 1.5]} frameloop={active ? "always" : "never"} camera={{ position: [0, 0, 4.2], fov: 35 }} gl={{ antialias: true, alpha: true }}>
    <ambientLight intensity={0.6} />
    <directionalLight position={[-2, 2, 2]} intensity={2.5} color="#C6F432" />
    <pointLight position={[2, -1, 2]} intensity={12} color="#7CC4FF" />
    <Cube pulses={pulses} />
  </Canvas>;
}
