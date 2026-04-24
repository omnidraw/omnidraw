# Konva.js

> Konva.js is the most popular open-source 2D HTML5 Canvas JavaScript framework. It provides an object-oriented API for canvas graphics with shapes, animations, events, drag-and-drop, filters, and official integrations with React, Vue, Svelte, and Angular. MIT licensed, created in 2014, used by Meta, Microsoft, Labelbox, Zazzle, and thousands of developers.

Konva uses a Stage → Layer → Group → Shape hierarchy. You create a Stage (attached to a DOM container), add Layers (each is a separate `<canvas>` element), and draw Shapes (Rect, Circle, Ellipse, Line, Text, Image, Path, Star, Ring, Arc, Arrow, Label, RegularPolygon, Wedge, Sprite, TextPath) on those layers.

Key capabilities: object-oriented shape management, full event system (click, hover, touch, drag), built-in drag-and-drop, animations and tweens, image filters (blur, brighten, contrast, grayscale, etc.), canvas serialization/deserialization (toJSON/fromJSON), high-quality image export (toDataURL, toBlob), node nesting and grouping, hit detection, and caching for performance.

Install: `npm install konva`

## Docs

- [Getting Started](https://konvajs.org/docs/index.html): Installation, basic setup, first canvas
- [API Reference](https://konvajs.org/api/Konva.html): Full API documentation for all classes

## Tutorials

- [Shapes](https://konvajs.org/docs/shapes/Rect.html): Drawing rectangles, circles, lines, text, images, paths, and more
- [Events](https://konvajs.org/docs/events/Binding_Events.html): Click, hover, touch, keyboard, and custom events
- [Drag and Drop](https://konvajs.org/docs/drag_and_drop/Drag_and_Drop.html): Built-in drag-and-drop system
- [Animations](https://konvajs.org/docs/animations/Create_an_Animation.html): Frame-based animations and tweens
- [Filters](https://konvajs.org/docs/filters/Blur.html): Image processing filters
- [Performance](https://konvajs.org/docs/performance/All_Performance_Tips.html): Optimization tips for large applications
- [Serialization](https://konvajs.org/docs/data_and_serialization/Serialize_a_Stage.html): Save and load canvas state
- [Select and Transform](https://konvajs.org/docs/select_and_transform/Basic_demo.html): Resize, rotate, and transform shapes interactively
- [Node.js](https://konvajs.org/docs/nodejs/index.html): Server-side canvas rendering

## Konva Events
To detect shape events with Konva, we can use the on() method to bind event handlers to a node.

The on() method requires an event type and a function to be executed when the event occurs.

Mouse events: mouseover, mouseout, mouseenter, mouseleave, mousemove, mousedown, mouseup, wheel, click, dblclick.

Touch events: touchstart, touchmove, touchend, tap, dbltap.

Pointer events: pointerdown, pointermove, pointereup, pointercancel, pointerover, pointerenter, pointerout,pointerleave, pointerclick, pointerdblclick.

Drag events: dragstart, dragmove, and dragend.

Transform events: transformstart, transform, transformend.
