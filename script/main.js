"use strict";

const bullets = [];
const explosions = [];
const smokeClouds = [];
const enemyHelicopters = [];

let gameTick = 0;
let pause = false;

main();

function main() {
    window.onload = () => {
        document.querySelector("#pause")
            .addEventListener("click", () => pause = !pause);
    };
    window.onerror = function (message, source, lineno, colno, error) {
        console.log('error!', message)
    };
    document.onmousemove = handleMouseMove;
    document.onclick = handleMouseClick

    setInterval(gameLoop, 25);
}

function gameLoop() {
    if (!pause) {
        runCheckLoop();
    }
}

function runCheckLoop() {

    if (gameTick % 200 === 0) {
        const heliDiv = createEnemyHeliDiv();
        appendToGame(heliDiv)
        enemyHelicopters.push({health: 100, div: heliDiv, hasFire: false});
    }

    handleBullets();
    handleSmokeClouds();
    handleExplosions();
    handleHelicopters();

    const gameBox = document.querySelector('.game-box');

    function removeSelf(div) {
        div.parentNode.removeChild(div);
    }

    function addExplosion(left, bottom) {
        const div = createDivWithClassName('explosion')
        div.style.left = (left - 15) + 'px'
        div.style.bottom = (bottom - 15) + 'px'
        appendToGame(div);
        explosions.push({tick: 0, div: div});
    }

    function calculateHelicopterIsHit(explosion) {
        const explosionRect = explosion.div.getBoundingClientRect();
        enemyHelicopters.forEach(heli => {
            const heliRect = heli.div.getBoundingClientRect();
            const isHit = !(explosionRect.right < heliRect.left ||
                explosionRect.left > heliRect.right ||
                explosionRect.bottom < heliRect.top ||
                explosionRect.top > heliRect.bottom);
            if (isHit && heli.health >= 10) {
                heli.health -= 10;
                heli.div.firstElementChild.value -= 10;
            }
        })
    }

    function handleBullets() {
        if (bullets.length > 0) {
            bullets.forEach((bullet, index) => {
                const course = bullet.course;
                const style = bullet.div.style;
                if (course != null && course.stepCount > 0) {
                    course.stepCount -= 1;
                    style.bottom = getIncrementedStyleValue(style.bottom, course.yStepDist);
                    style.left = getIncrementedStyleValue(style.left, course.xStepDist);
                } else {
                    removeSelf(bullet.div);
                    bullets.splice(index, 1);
                    addExplosion(parseStylePixelValue(style.left), parseStylePixelValue(style.bottom));
                }
            })
        }
    }


    function handleExplosions() {
        if (explosions.length > 0) {
            explosions.forEach((explosion, index) => {
                if (explosion.tick === 1) {
                    calculateHelicopterIsHit(explosion);
                }
                if (explosion.tick >= 5) {
                    const div = createDivWithClassName('smoke-cloud');
                    const explosionStyle = explosion.div.style;
                    div.style.bottom = explosionStyle.bottom;
                    div.style.left = explosionStyle.left;
                    appendToGame(div)
                    smokeClouds.push({tick: 0, div: div})
                    explosions.splice(index, 1);
                    removeSelf(explosion.div)
                } else {
                    explosion.tick += 1;
                }
            })
        }
    }


    function handleSmokeClouds() {
        if (smokeClouds.length > 0) {
            smokeClouds.forEach((smoke, index) => {
                if (smoke.tick >= 60) {
                    smokeClouds.splice(index, 1);
                    smoke.div.parentNode.removeChild(smoke.div);
                } else {
                    const explosionStyle = smoke.div.style;
                    if (smoke.tick >= 40) {
                        if (smoke.tick % 2 === 0) {
                            let number = Number(explosionStyle.opacity);
                            number -= 0.1;
                            explosionStyle.opacity = number.toString();
                        }
                        if (smoke.tick % 5 === 0 || smoke.tick === 0) {
                            const styleValue = parseStylePixelValue(explosionStyle.left);
                            explosionStyle.left = (styleValue - 1) + 'px';
                        }
                        smoke.tick += 1;
                    } else {
                        if (smoke.tick % 5 === 0 || smoke.tick === 0) {
                            const styleValue = parseStylePixelValue(explosionStyle.left);
                            explosionStyle.left = (styleValue - 1) + 'px';
                        }
                        smoke.tick += 1;
                    }
                }
            })
        }
    }


    function handleHelicopters() {
        if (enemyHelicopters.length > 0) {
            enemyHelicopters.forEach((heli, index) => {
                const heliStyle = heli.div.style;
                let speed = getIncrementedStyleValue(heliStyle.right, 1);
                speed = speed == null ? '100px' : speed;
                heliStyle.right = speed;

                if (heli.health === 0) {
                    if (!heli.hasFire) {
                        const fireDiv = createDivWithClassName('fire')
                        heli.div.appendChild(fireDiv);
                        heli.hasFire = true;
                    }
                    let heliHeight = getIncrementedStyleValue(heliStyle.top, 5);
                    heliHeight = heliHeight == null ? '300px' : heliHeight;
                    heliStyle.top = heliHeight;
                    heliStyle.transform = 'rotate(10deg)'
                }
                if (parseStylePixelValue(heliStyle.top) > 800) {
                    removeSelf(heli.div)
                    enemyHelicopters.splice(index, 1);
                }
            })
        }
    }

    gameTick++;
}

function handleMouseClick($event) {
    const bulletCourse = createBulletCourse($event.pageX, $event.pageY);
    const bulletDiv = createBulletDivAndAddToGame();
    bullets.push({course: bulletCourse, div: bulletDiv})
}

function appendToGame(element) {
    const gameBox = document.querySelector('.game-box');
    gameBox.appendChild(element);
}

function createBulletDivAndAddToGame() {
    const bulletDiv = createDivWithClassName('bullet')
    bulletDiv.style.bottom = '22px';
    bulletDiv.style.left = '0px';
    appendToGame(bulletDiv);
    return bulletDiv;
}

function createDivWithClassName(className) {
    const div = document.createElement('div');
    div.className = className
    return div;
}

function createEnemyHeliDiv() {
    const heliDiv = createDivWithClassName('helicopter')
    const progressElement = createHeliHealthBar();
    heliDiv.appendChild(progressElement)
    return heliDiv;
}

function createHeliHealthBar() {
    const progressElement = document.createElement('progress');
    progressElement.max = 100;
    progressElement.value = 100;
    return progressElement;
}

function createBulletCourse(xCoordsTarget, yCoordsTarget) {
    const xStart = 8;
    const yStart = 772;

    const yDist = yStart - yCoordsTarget;
    const xDist = xCoordsTarget - xStart;
    if (yDist > 0 && xDist > 0) {
        const zDistance = getZDistance(xDist, yDist);

        const nrOfSteps = Math.round(zDistance / 15);
        const yStepDist = Math.round(yDist / nrOfSteps);
        const xStepDist = Math.round(xDist / nrOfSteps);
        return {stepCount: nrOfSteps, yStepDist: yStepDist, xStepDist: xStepDist}
    }
}

function handleMouseMove(event) {
    const xValue = event.pageX - 30;
    const yValue = 800 - event.pageY;
    const angle = getAngle(xValue, yValue);
    transformCannonAngle(angle);
}

function transformCannonAngle(angle) {
    document.getElementById('cannon').style.transform = getRotationString(angle);
}

function getRotationString(angle) {
    const normalized = Math.round(angle);
    return "rotate(" + (360 - normalized) + "deg)";
}

function getZDistance(xValue, yValue) {
    return Math.sqrt(Math.pow(xValue, 2) + Math.pow(yValue, 2));
}

function getAngle(xValue, yValue) {
    const length = getZDistance(xValue, yValue);
    return Math.sin(yValue / length) * (180 / Math.PI);
}

function parseStylePixelValue(value) {
    if (value !== "") {
        return Number(value.substr(0, value.length - 2));
    }
}

function getIncrementedStyleValue(styleValue, increment) {
    if (styleValue !== "") {
        const nrVal = styleValue.substr(0, styleValue.length - 2);
        const incremented = Number(nrVal) + increment;
        return `${incremented}px`
    }

}
