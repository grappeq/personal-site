import React, { useState } from 'react';
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

const MIN_CONTRAST_RATIO = 1.5;
const MY_FACE_REFERENCE_COLOR = chroma('#EEC4CF');

function generateMatchingColors() {
    const backgroundColor = chroma.random().saturate(2).luminance(0.8);
    const [hue, saturation, lightness] = backgroundColor.hsl();
    const foregroundColor = chroma.hsl((hue + 180) % 360, saturation, lightness);
    return { backgroundColor, foregroundColor };
}

function generateNiceContrastingColors() {
    let last;
    for (let i = 0; i < 100; i++) {
        last = generateMatchingColors();
        if (chroma.contrast(last.backgroundColor, last.foregroundColor) > MIN_CONTRAST_RATIO) {
            return last;
        }
    }
    return last;
}

function App() {
    const [colors, setColors] = useState(generateNiceContrastingColors);
    const [emailHidden, setEmailHidden] = useState(true);

    const regenerateColors = () => setColors(generateNiceContrastingColors());

    const textStyle = { color: colors.foregroundColor };
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
                <img
                    src={photo}
                    className="photo"
                    style={photoStyle}
                    alt="Photo of Kacper Grabowski"
                    role="button"
                    tabIndex={0}
                    aria-label="Regenerate page colors"
                    onClick={regenerateColors}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            regenerateColors();
                        }
                    }}
                />
                <div className="name" style={textStyle}>
                    Kacper Grabowski
                </div>
                <div className="position" style={textStyle}>
                    Engineering Manager
                </div>
                <div className={`email ${emailHidden ? '' : ' expanded'}`}>
                    <button
                        type="button"
                        className="email-icon-button"
                        aria-label={emailHidden ? 'Reveal email address' : 'Hide email address'}
                        aria-expanded={!emailHidden}
                        onClick={() => setEmailHidden(!emailHidden)}
                        style={textStyle}
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
                                style={textStyle}
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
                    <FontAwesomeIcon icon={['fab', 'linkedin']} style={textStyle} />
                </a>

                <a
                    href="https://github.com/grappeq"
                    aria-label="GitHub profile"
                    target="_blank"
                    rel="noopener noreferrer"
                >
                    <FontAwesomeIcon icon={['fab', 'github']} style={textStyle} />
                </a>
            </div>
        </div>
    );
}

export default App;
