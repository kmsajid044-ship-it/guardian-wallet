import { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Environment, Lightformer } from "@react-three/drei";
import { CanvasTexture, ExtrudeGeometry, Path, SRGBColorSpace, Shape, type Group } from "three";

/*
 * Home hero: a rounded glass shield with a padlock cut out of it. It stands for protection, not money.
 * One turn every 20 s, tilting a few degrees toward the pointer. Lighting is procedural (no files).
 */

const TURN_SECONDS = 20;
const TILT = 0.12; // radians, about 7 degrees

function shieldGeometry(): ExtrudeGeometry {
  const outline = new Shape();
  outline.moveTo(0, 1.32);
  outline.bezierCurveTo(0.45, 1.32, 0.76, 1.18, 1.02, 1.02);
  outline.bezierCurveTo(1.05, 0.2, 0.86, -0.78, 0, -1.4);
  outline.bezierCurveTo(-0.86, -0.78, -1.05, 0.2, -1.02, 1.02);
  outline.bezierCurveTo(-0.76, 1.18, -0.45, 1.32, 0, 1.32);
  // Padlock silhouette: body plus shackle, cut through the shield.
  const lock = new Path();
  lock.moveTo(-0.34, -0.52); lock.lineTo(0.34, -0.52); lock.lineTo(0.34, -0.02); lock.lineTo(0.23, -0.02);
  lock.lineTo(0.23, 0.14); lock.absarc(0, 0.14, 0.23, 0, Math.PI, false);
  lock.lineTo(-0.23, -0.02); lock.lineTo(-0.34, -0.02); lock.lineTo(-0.34, -0.52);
  outline.holes.push(lock);
  // The space inside the shackle stays glass.
  const inside = new Shape();
  inside.moveTo(-0.13, -0.02); inside.lineTo(0.13, -0.02); inside.lineTo(0.13, 0.14);
  inside.absarc(0, 0.14, 0.13, 0, Math.PI, false); inside.lineTo(-0.13, -0.02);
  const geometry = new ExtrudeGeometry([outline, inside], { depth: 0.26, bevelEnabled: true, bevelThickness: 0.12, bevelSize: 0.08, bevelSegments: 8, curveSegments: 48 });
  geometry.center();
  return geometry;
}

/** Soft lime and sky glow behind the shield, so the glass has colour to refract. Drawn once, no files. */
function Backdrop() {
  const texture = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 256;
    const context = canvas.getContext("2d")!;
    const glow = (x: number, y: number, r: number, color: string) => {
      const gradient = context.createRadialGradient(x, y, 0, x, y, r);
      gradient.addColorStop(0, color); gradient.addColorStop(1, "rgba(0,0,0,0)");
      context.fillStyle = gradient; context.fillRect(0, 0, 256, 256);
    };
    glow(112, 112, 92, "rgba(198,244,50,0.5)");
    glow(150, 150, 92, "rgba(124,196,255,0.45)");
    const result = new CanvasTexture(canvas);
    result.colorSpace = SRGBColorSpace;
    return result;
  }, []);
  useEffect(() => () => texture.dispose(), [texture]);
  return <mesh position={[0, 0, -2.2]}><planeGeometry args={[7, 7]} /><meshBasicMaterial map={texture} transparent depthWrite={false} /></mesh>;
}

function Shield() {
  const group = useRef<Group>(null);
  const pointer = useRef({ x: 0, y: 0 });
  const geometry = useMemo(shieldGeometry, []);
  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => {
    const move = (event: PointerEvent) => { pointer.current = { x: (event.clientX / innerWidth) * 2 - 1, y: (event.clientY / innerHeight) * 2 - 1 }; };
    addEventListener("pointermove", move, { passive: true });
    return () => removeEventListener("pointermove", move);
  }, []);
  useFrame((_, delta) => {
    const node = group.current;
    if (!node) return;
    node.rotation.y += (delta * Math.PI * 2) / TURN_SECONDS;
    node.rotation.x += (pointer.current.y * TILT - node.rotation.x) * Math.min(1, delta * 3);
    node.rotation.z += (-pointer.current.x * TILT * 0.5 - node.rotation.z) * Math.min(1, delta * 3);
  });
  return <group ref={group}>
    <mesh geometry={geometry} scale={1}>
      <meshPhysicalMaterial transmission={0.92} roughness={0.1} thickness={0.9} ior={1.45} iridescence={0.18} iridescenceIOR={1.3}
        clearcoat={1} clearcoatRoughness={0.08} color="#eef6e4" attenuationColor="#eaffb8" attenuationDistance={6} envMapIntensity={0.85} specularIntensity={1} />
    </mesh>
  </group>;
}

export default function ShieldCanvas({ active }: { active: boolean }) {
  return <Canvas className="scene-canvas" dpr={[1, 1.5]} frameloop={active ? "always" : "never"} camera={{ position: [0, 0, 6.2], fov: 34 }} gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}>
    <ambientLight intensity={0.35} />
    <directionalLight position={[-3, 2.5, -3]} intensity={4} color="#C6F432" />
    <pointLight position={[3, -1.5, 3]} intensity={26} color="#7CC4FF" />
    <Backdrop />
    <Shield />
    <Environment resolution={128}>
      <Lightformer form="rect" intensity={1.2} position={[0, 3, 2]} scale={[6, 2, 1]} color="#ffffff" />
      <Lightformer form="rect" intensity={2.6} position={[-4, 0, -2]} rotation-y={Math.PI / 2} scale={[4, 3, 1]} color="#C6F432" />
      <Lightformer form="rect" intensity={2.2} position={[4, -1, 1]} rotation-y={-Math.PI / 2} scale={[4, 3, 1]} color="#7CC4FF" />
    </Environment>
  </Canvas>;
}
