"use strict";

const xOffset = 30;
const yOffset = 800;
const cannonDivId = "cannon";
const bulletStartY = 22;
const bulletSpeed = 15;

const bullets = [];
const explosions = [];
const smokeClouds = [];

const enemyHelicopters = [];

let gameTick = 0;
let pause = false;

main();


function main() {

    window.onload = function () {
        document.querySelector("#pause").addEventListener("click", function () {
            pause = !pause;
        });
    };
    document.onmousemove = handleMouseMove;
    document.onclick = handleMouseClick

    var tid = setInterval(timerLoop, 25);
}

// Get position of div element
// const element = document.querySelector('.bullet');
//     console.log(element.getBoundingClientRect());


function handleMouseClick($event) {
    const bulletCourse = createBulletCourse($event.pageX, $event.pageY);
    const bulletDiv = createBulletDiv();
    bullets.push({course: bulletCourse, div: bulletDiv})
}

function createBulletDiv() {
    const bulletDiv = document.createElement('div');
    const gameBox = document.querySelector('.game-box');
    bulletDiv.className = 'bullet';
    bulletDiv.style.bottom = '22px';
    bulletDiv.style.left = '0px';
    gameBox.appendChild(bulletDiv);
    return bulletDiv;
}

function createExplosionDiv() {
    const explosionDiv = document.createElement('div');
    explosionDiv.className = 'explosion'
    return explosionDiv;
}

function createSmokeCloudDiv() {
    const explosionDiv = document.createElement('div');
    explosionDiv.className = 'smoke-cloud'
    return explosionDiv;
}

function createEnemyHeliDiv() {
    const heliDiv = document.createElement('div');
    heliDiv.className = 'helicopter'
    const progressElement = document.createElement('progress');
    progressElement.max = 100;
    progressElement.value = 100;
    heliDiv.appendChild(progressElement)
    return heliDiv;
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
    const xValue = event.pageX - xOffset;
    const yValue = yOffset - event.pageY;
    const angle = getAngle(xValue, yValue);
    transformCannonAngle(angle);
}

function transformCannonAngle(angle) {
    document.getElementById(cannonDivId).style.transform = getRotationString(angle);
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

function runcheckLoop() {
    const gameBox = document.querySelector('.game-box');
    if (bullets.length > 0) {
        bullets.forEach((bullet, index) => {
            if (bullet.course.stepCount > 0) {
                bullet.course.stepCount -= 1;
                const xIncrement = bullet.course.xStepDist;
                const yIncrement = bullet.course.yStepDist;

                bullet.div.style.bottom = getIncrementedStyleValue(bullet.div.style.bottom, yIncrement);
                bullet.div.style.left = getIncrementedStyleValue(bullet.div.style.left, xIncrement);


            } else {
                bullet.div.parentNode.removeChild(bullet.div);
                bullets.splice(index, 1);
                const bottom = parseStylePixelValue(bullet.div.style.bottom);
                const left = parseStylePixelValue(bullet.div.style.left);
                const div = createExplosionDiv();
                div.style.left = (left - 15) + 'px'
                div.style.bottom = (bottom - 15) + 'px'
                gameBox.appendChild(div);
                explosions.push({tick: 0, div: div});
            }
        })
    }

    if (explosions.length > 0) {
        explosions.forEach((explosion, index) => {
            if (explosion.tick === 1) {
                const explosionRect = explosion.div.getBoundingClientRect();
                enemyHelicopters.forEach(heli => {

                    const heliRect = heli.div.getBoundingClientRect();
                    const isHit = !(explosionRect.right < heliRect.left ||
                        explosionRect.left > heliRect.right ||
                        explosionRect.bottom < heliRect.top ||
                        explosionRect.top > heliRect.bottom);

                    if (isHit && heli.health >= 10) {
                        console.log('Heli is hit!');
                        heli.health -= 10;
                        heli.div.firstElementChild.value -= 10;
                    }

                })
            }
            if (explosion.tick >= 5) {
                const div = createSmokeCloudDiv();
                div.style.bottom = explosion.div.style.bottom;
                div.style.left = explosion.div.style.left;
                gameBox.appendChild(div);
                smokeClouds.push({tick: 0, div: div})
                explosions.splice(index, 1);
                explosion.div.parentNode.removeChild(explosion.div);
            } else {
                explosion.tick += 1;
            }
        })
    }

    if (smokeClouds.length > 0) {
        smokeClouds.forEach((smoke, index) => {
            if (smoke.tick >= 60) {
                smokeClouds.splice(index, 1);
                smoke.div.parentNode.removeChild(smoke.div);
            } else if (smoke.tick >= 40) {
                if (smoke.tick % 2 === 0) {
                    let number = Number(smoke.div.style.opacity);
                    number -= 0.1;
                    smoke.div.style.opacity = number.toString();
                }
                if (smoke.tick % 5 === 0 || smoke.tick === 0) {
                    const styleValue = parseStylePixelValue(smoke.div.style.left);
                    smoke.div.style.left = (styleValue - 1) + 'px';
                }
                smoke.tick += 1;
            } else {
                if (smoke.tick % 5 === 0 || smoke.tick === 0) {
                    const styleValue = parseStylePixelValue(smoke.div.style.left);
                    smoke.div.style.left = (styleValue - 1) + 'px';
                }
                smoke.tick += 1;
            }
        })
    }

    if (enemyHelicopters.length > 0) {
        enemyHelicopters.forEach((heli, index) => {
            let speed = getIncrementedStyleValue(heli.div.style.right, 1);
            speed = speed == null ? '100px' : speed;
            heli.div.style.right = speed;

            if (heli.health === 0) {
                if (!heli.hasFire) {
                    const fireDiv = document.createElement('div');
                    fireDiv.className = 'fire';
                    heli.div.appendChild(fireDiv);
                    heli.hasFire = true;
                }
                let incrementedStyleValue = getIncrementedStyleValue(heli.div.style.top, 5);
                incrementedStyleValue = incrementedStyleValue == null ? '300px' : incrementedStyleValue;
                console.log(heli, incrementedStyleValue)
                heli.div.style.top = incrementedStyleValue;
                heli.div.style.transform = 'rotate(10deg)'
            }
            if (parseStylePixelValue(heli.div.style.top) > 800) {
                gameBox.removeChild(heli.div);
                enemyHelicopters.splice(index, 1);
            }
        })

    }

    if (gameTick % 200 === 0) {
        const heliDiv = createEnemyHeliDiv();
        gameBox.appendChild(heliDiv);
        enemyHelicopters.push({health: 100, div: heliDiv, hasFire: false});
    }

    gameTick++;
    // console.log(gameTick)
}

function timerLoop() {
    if (!pause) {
        runcheckLoop();
    }

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
