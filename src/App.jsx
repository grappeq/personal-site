import React, { useEffect, useRef, useState } from 'react';
import { library } from '@fortawesome/fontawesome-svg-core';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faGithub, faLinkedin } from '@fortawesome/free-brands-svg-icons';
import { faCopy, faEnvelope } from '@fortawesome/free-solid-svg-icons';
import chroma from 'chroma-js';
import './App.css';
import photo from './photo.jpg';

library.add(faGithub, faLinkedin, faEnvelope, faCopy);

// to keep bots at bay
const EMAIL_ADDRESS = atob('a2FjcGVyQGdyYWJvdy5za2k=');

const HUE_DEGREES_PER_SECOND = 4; // full color wheel in ~90s (varies due to speedAt)
const MY_FACE_REFERENCE_COLOR = chroma('#EEC4CF');

// Pure blue (~240°) renders poorly compared to other hues, so accelerate through it.
const BLUE_HUE = 240;
const BLUE_HUE_RADIUS = 25; // ± degrees considered "near pure blue"
const BLUE_SPEED_MULTIPLIER = 5;

function hueDistance(a, b) {
    let dist = Math.abs(a - b);
    if (dist > 180) dist = 360 - dist;
    return dist;
}

function speedAt(hue) {
    // Accelerate when either the background (hue) or the foreground (hue + 180) is near blue.
    const distBg = hueDistance(hue, BLUE_HUE);
    const distFg = hueDistance((hue + 180) % 360, BLUE_HUE);
    const minDist = Math.min(distBg, distFg);
    if (minDist >= BLUE_HUE_RADIUS) return 1;
    const proximity = 1 - minDist / BLUE_HUE_RADIUS; // 0 at edge, 1 at center
    return 1 + (BLUE_SPEED_MULTIPLIER - 1) * proximity;
}

// Photo throw physics
const GRAVITY = 900; // px/s^2 — low-ish (real-world ~9800 at 100dpi)
const AIR_DRAG_PER_SECOND = 0.35; // exponential horizontal velocity decay
const BOUNCE_DAMPING = 0.72; // velocity retained after each bounce
const REST_SPEED = 25; // px/s — below this (on floor) we stop the loop
const DRAG_THRESHOLD_PX = 6; // movement above this counts as drag, not click
const VELOCITY_SAMPLE_MS = 90; // window for release-velocity calculation

function colorsForHue(hue) {
    const backgroundColor = chroma.hsl(hue, 1, 0.5).saturate(3).luminance(0.8);
    const [, saturation, lightness] = backgroundColor.hsl();
    const foregroundColor = chroma.hsl((hue + 180) % 360, saturation, lightness);
    return { backgroundColor, foregroundColor };
}

function App() {
    const hueRef = useRef(Math.random() * 360);
    const [colors, setColors] = useState(() => colorsForHue(hueRef.current));
    const [emailHidden, setEmailHidden] = useState(true);

    // Photo throw state
    const photoWrapperRef = useRef(null);
    const dragRef = useRef(null);
    const physicsRef = useRef(null);
    const physicsFrameRef = useRef(null);
    const [photoOffset, setPhotoOffset] = useState({ x: 0, y: 0 });

    const regenerateColors = () => {
        hueRef.current = Math.random() * 360;
        setColors(colorsForHue(hueRef.current));
    };

    const stopPhysics = () => {
        if (physicsFrameRef.current) {
            cancelAnimationFrame(physicsFrameRef.current);
            physicsFrameRef.current = null;
        }
        physicsRef.current = null;
    };

    const startPhysics = (startX, startY, vx, vy) => {
        const wrapper = photoWrapperRef.current;
        if (!wrapper) return;
        const rect = wrapper.getBoundingClientRect();
        // Layout origin = current visual position minus the offset we've applied
        const homeLeft = rect.left - startX;
        const homeTop = rect.top - startY;
        const bounds = {
            minX: -homeLeft,
            maxX: window.innerWidth - homeLeft - rect.width,
            minY: -homeTop,
            maxY: window.innerHeight - homeTop - rect.height,
        };

        physicsRef.current = { x: startX, y: startY, vx, vy };
        let lastTime = performance.now();

        const step = (now) => {
            const p = physicsRef.current;
            if (!p) return;
            const dt = Math.min((now - lastTime) / 1000, 0.05); // clamp to 50ms
            lastTime = now;

            p.vy += GRAVITY * dt;
            p.vx *= Math.exp(-AIR_DRAG_PER_SECOND * dt);
            p.x += p.vx * dt;
            p.y += p.vy * dt;

            if (p.x < bounds.minX) {
                p.x = bounds.minX;
                p.vx = -p.vx * BOUNCE_DAMPING;
            } else if (p.x > bounds.maxX) {
                p.x = bounds.maxX;
                p.vx = -p.vx * BOUNCE_DAMPING;
            }
            if (p.y < bounds.minY) {
                p.y = bounds.minY;
                p.vy = -p.vy * BOUNCE_DAMPING;
            } else if (p.y > bounds.maxY) {
                p.y = bounds.maxY;
                p.vy = -p.vy * BOUNCE_DAMPING;
            }

            setPhotoOffset({ x: p.x, y: p.y });

            const atFloor = p.y >= bounds.maxY - 0.5;
            const speed = Math.hypot(p.vx, p.vy);
            if (atFloor && speed < REST_SPEED) {
                stopPhysics();
                return;
            }
            physicsFrameRef.current = requestAnimationFrame(step);
        };

        physicsFrameRef.current = requestAnimationFrame(step);
    };

    const onPhotoPointerDown = (e) => {
        const wrapper = photoWrapperRef.current;
        if (!wrapper) return;
        e.preventDefault();
        wrapper.setPointerCapture(e.pointerId);
        stopPhysics();
        dragRef.current = {
            pointerId: e.pointerId,
            startClientX: e.clientX,
            startClientY: e.clientY,
            startOffsetX: photoOffset.x,
            startOffsetY: photoOffset.y,
            samples: [{ t: performance.now(), x: photoOffset.x, y: photoOffset.y }],
            moved: false,
        };
    };

    const onPhotoPointerMove = (e) => {
        const drag = dragRef.current;
        if (!drag || drag.pointerId !== e.pointerId) return;
        const dx = e.clientX - drag.startClientX;
        const dy = e.clientY - drag.startClientY;
        if (!drag.moved && Math.hypot(dx, dy) > DRAG_THRESHOLD_PX) {
            drag.moved = true;
        }
        if (!drag.moved) return;
        const newX = drag.startOffsetX + dx;
        const newY = drag.startOffsetY + dy;
        setPhotoOffset({ x: newX, y: newY });
        const now = performance.now();
        drag.samples.push({ t: now, x: newX, y: newY });
        const cutoff = now - VELOCITY_SAMPLE_MS;
        while (drag.samples.length > 2 && drag.samples[0].t < cutoff) {
            drag.samples.shift();
        }
    };

    const onPhotoPointerUp = (e) => {
        const drag = dragRef.current;
        if (!drag || drag.pointerId !== e.pointerId) return;
        photoWrapperRef.current?.releasePointerCapture(e.pointerId);
        dragRef.current = null;

        if (!drag.moved) {
            regenerateColors();
            return;
        }

        const finalX = drag.startOffsetX + (e.clientX - drag.startClientX);
        const finalY = drag.startOffsetY + (e.clientY - drag.startClientY);
        let vx = 0;
        let vy = 0;
        if (drag.samples.length >= 2) {
            const first = drag.samples[0];
            const last = drag.samples[drag.samples.length - 1];
            const dt = (last.t - first.t) / 1000;
            if (dt > 0) {
                vx = (last.x - first.x) / dt;
                vy = (last.y - first.y) / dt;
            }
        }
        startPhysics(finalX, finalY, vx, vy);
    };

    useEffect(() => {
        if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
            return;
        }
        let frame;
        let lastTime = performance.now();
        const loop = (now) => {
            const dt = Math.min((now - lastTime) / 1000, 0.1);
            lastTime = now;
            const delta = HUE_DEGREES_PER_SECOND * speedAt(hueRef.current) * dt;
            hueRef.current = (hueRef.current + delta) % 360;
            setColors(colorsForHue(hueRef.current));
            frame = requestAnimationFrame(loop);
        };
        frame = requestAnimationFrame(loop);
        return () => cancelAnimationFrame(frame);
    }, []);

    useEffect(() => stopPhysics, []);

    const shadow = colors.foregroundColor.luminance(0.08).hex();
    const textStyle = {
        color: colors.foregroundColor,
        textShadow: `0 1px 0 ${shadow}, 1px 0 0 ${shadow}, -1px 0 0 ${shadow}, 0 -1px 0 ${shadow}`,
    };
    const iconStyle = {
        color: colors.foregroundColor,
        filter: `drop-shadow(0 1px 0 ${shadow}) drop-shadow(1px 0 0 ${shadow}) drop-shadow(-1px 0 0 ${shadow}) drop-shadow(0 -1px 0 ${shadow})`,
    };
    const backgroundStyle = { backgroundColor: colors.backgroundColor };

    const [hueOfMyFace] = MY_FACE_REFERENCE_COLOR.hsv();
    const [foregroundColorHue] = colors.foregroundColor.hsv();
    const photoStyle = {
        filter: `hue-rotate(${foregroundColorHue - hueOfMyFace}deg) saturate(200%)`,
    };

    const copyEmail = () => {
        if (navigator.clipboard) {
            navigator.clipboard.writeText(EMAIL_ADDRESS);
        }
    };

    return (
        <div className="app" style={backgroundStyle}>
            <div className="app-body">
                <div
                    ref={photoWrapperRef}
                    className="photo-wrapper"
                    style={{ transform: `translate(${photoOffset.x}px, ${photoOffset.y}px)` }}
                    onPointerDown={onPhotoPointerDown}
                    onPointerMove={onPhotoPointerMove}
                    onPointerUp={onPhotoPointerUp}
                    onPointerCancel={onPhotoPointerUp}
                >
                    <img
                        src={photo}
                        className="photo"
                        style={photoStyle}
                        alt="Photo of Kacper Grabowski"
                        role="button"
                        tabIndex={0}
                        aria-label="Regenerate page colors, or drag to throw"
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                regenerateColors();
                            }
                        }}
                        draggable={false}
                    />
                </div>
                <div className="name" style={textStyle}>
                    Kacper Grabowski
                </div>
                <div className="position" style={textStyle}>
                    Engineering Leader
                </div>
                <div className={`email ${emailHidden ? '' : ' expanded'}`}>
                    <button
                        type="button"
                        className="email-icon-button"
                        aria-label={emailHidden ? 'Reveal email address' : 'Hide email address'}
                        aria-expanded={!emailHidden}
                        onClick={() => setEmailHidden(!emailHidden)}
                        style={iconStyle}
                    >
                        <FontAwesomeIcon icon={['fas', 'envelope']} className="email-icon" />
                    </button>
                    {!emailHidden && (
                        <div className="email-text">
                            <a href={`mailto:${EMAIL_ADDRESS}`} style={textStyle}>
                                {EMAIL_ADDRESS}
                            </a>
                            <button
                                type="button"
                                className="email-copy-button"
                                aria-label="Copy email address to clipboard"
                                onClick={copyEmail}
                                style={iconStyle}
                            >
                                <FontAwesomeIcon icon={['fas', 'copy']} />
                            </button>
                        </div>
                    )}
                </div>
            </div>

            <div className="app-footer">
                <a
                    href="https://www.linkedin.com/in/grabowskikacper/"
                    aria-label="LinkedIn profile"
                    target="_blank"
                    rel="noopener noreferrer"
                >
                    <FontAwesomeIcon icon={['fab', 'linkedin']} style={iconStyle} />
                </a>

                <a
                    href="https://github.com/grappeq"
                    aria-label="GitHub profile"
                    target="_blank"
                    rel="noopener noreferrer"
                >
                    <FontAwesomeIcon icon={['fab', 'github']} style={iconStyle} />
                </a>
            </div>
        </div>
    );
}

export default App;
