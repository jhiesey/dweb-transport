/*
Based on https://stackoverflow.com/questions/30430982/can-i-use-jsx-without-react-to-inline-html-in-script
I wanted this because React was doing nasty things at run-time (like catching events) and stopping Search box working

This expanded in use to make it easier to use HTML in as unchanged form from existing react in particular.
- URLs in image tags are re-rooted, i.e. <img src="/foo"> => <img src="https://bar.com/foo">
- look at onClick's especially if set window.location
 */
import RenderMedia from 'render-media';
import ArchiveFile from "./ArchiveFile";

function deletechildren(el, keeptemplate) { //Note same function in htmlutils
    /*
    Remove all children from a node
    :param el:  An HTML element, or a string with id of an HTML element
    */
    if (typeof keeptemplate === "undefined") keeptemplate=true;
    el = (typeof(el) === "string") ? document.getElementById(el) : el;
    // Carefull - this deletes from the end, because template if it exists will be firstChild
    while (el.lastChild && !(keeptemplate && el.lastChild.classList && el.lastChild.classList.contains("template"))) {
        // Note that deletechildren is also used on Span's to remove the children before replacing with text.
        el.removeChild(el.lastChild);
    }
    return el; // For chaining
}

export default class React  {
    static async p_loadImg(jsx, name, urls, cb) {
        /*
        This is the asyncronous part of loadImg, runs in the background to update the image.
        Previous version got a static (non stream) content and puts in an existing IMG tag but this fails in Firefox
        This version appends to a tag using RenderMedia.append which means using a stream
        Note it can't be inside load_img which has to be synchronous and return a jsx tree.

         */
        /*
        //This method makes use of the full Dweb library, can get any kind of link, BUT doesnt work in Firefox, the image doesn't get rendered.
        let blk = await  Dweb.Block.p_fetch(urls, verbose);  //Typically will be a Uint8Array
        let blob = new Blob([blk._data], {type: Util.archiveMimeTypeFromFormat[this.metadata.format]}) // Works for data={Uint8Array|Blob}
        // This next code is bizarre combination needed to open a blob from within an HTML window.
        let objectURL = URL.createObjectURL(blob);
        if (verbose) console.log("Blob URL=",objectURL);
        //jsx.src = `http://archive.org/download/${this.itemid}/${this.metadata.name}`
        jsx.src = objectURL;
        */
        console.log("Rendering");
        var file = {
            name: name,
            createReadStream: function (opts) {
                // Return a readable stream that provides the bytes between offsets "start"
                // and "end" inclusive. This works just like fs.createReadStream(opts) from
                // the node.js "fs" module.

                return Dweb.Transports.createReadStream(urls, opts, verbose)
            }
        }

        RenderMedia.append(file, jsx, cb);  // Render into supplied element - have to use append, as render doesnt work, the cb will set attributes and/or add children.
    }

    static loadImg(name, urls, cb) {
        //asynchronously loads file from one of metadata, turns into blob, and stuffs into element
        // Usage like  {this.loadImg(<img width=10>))
        var element = document.createElement("div");
        this.p_loadImg(element, name, urls, cb); /* Asynchronously load image under element - note NOT awaiting return*/
        return element;
    }

    static config(options) {
        /*
            Configure ReachFake

            root: protocol and host to insert before URLs (currently in img tags only) e.g. "https://archive.org"
         */
        for (x of options) React._config[x] = options[x];
    }
    static createElement(tag, attrs, children) {        // Note arguments is set to tag, attrs, child1, child2 etc
        /* Replaces React's createElement - has a number of application specific special cases
            <img src=ArchiveFile(...)> replaced by <div><img x-=u>

         */

        /* First we handle cases where we dont actually build the tag requested */

        const kids = Array.prototype.slice.call(arguments).slice(2);
        
        function cb(err, element) {
            React.buildoutElement(element, tag, attrs, kids);
        }
        if (tag === "img" && Object.keys(attrs).includes("src") && attrs["src"] instanceof ArchiveFile) {
            //Its an image loaded from an ArchiveFile, so wrap in a DIV and pass children and attrs to renderer
            return this.loadImg(attrs["src"].name(), attrs["src"].urls(), cb);   //Creates a <div></div>, asynchronously creates an <img> under it and calls cb on that IMG. The <div> is returned immediately.
        } else {
            return this.buildoutElement(document.createElement(tag), tag, attrs, kids);
        }
    }
    static buildoutElement(element, tag, attrs, kids) {
        /* Build out a created element adding Attributes and Children
        tag:    Lower case string of element e.g. "img"
        attrs:  Object {attr: value}
        kids:   Array of children
        /* This is called back by loadImg after creating the tag. */
        for (let name in attrs) {
            const attrname = (name.toLowerCase() === "classname" ? "class" : name);
            if (name === "dangerouslySetInnerHTML") {
                element.innerHTML = attrs[name]["__html"];
                delete attrs.dangerouslySetInnerHTML;
            }
            // Turn relative URLS in IMG and A into absolute urls - ideally these are also caught by special cases
            if (["img.src", "a.href"].includes(tag + "." + name) && (typeof attrs[name] === "string") && attrs[name].startsWith('/')) {
                if (!React._config.root) console.error("Need to React.config({root: 'https://xyz.abc'");
                attrs[name] = React._config.root + attrs[name];  // e.g. /foo => https://bar.com/foo
            }
            // Load ArchiveFile inside a div if specify in src
            //TODO - first fix this to use classes etc and replace a node, THEN expand to /service/img/xxx
            if (["img.src"].includes(tag + "." + name) && attrs[name] instanceof ArchiveFile) {
                //attrs[name].loadImg(element);
            } else if (["video.src", "audio.src"].includes(tag + "." + name) && attrs[name] instanceof ArchiveFile) {
                attrs[name].loadStream(element);
            } else if (["a.source"].includes(tag + "." + name) && attrs[name] instanceof ArchiveFile) {
                element[name] = attrs[name];      // Store the ArchiveFile in the DOM, function e.g. onClick will access it.
            } else if (name && attrs.hasOwnProperty(name)) {
                let value = attrs[name];
                if (value === true) {
                    element.setAttribute(attrname, name);
                } else if (typeof value === "object" && !Array.isArray(value)) { // e.g. style: {{fontSize: "124px"}}
                    for (let k in value) {
                        element[attrname][k] = value[k];
                    }
                } else if (value !== false && value != null) {
                    element.setAttribute(attrname, value.toString());
                }
            }
        }
        for (let i = 0; i < kids.length; i++) {
            const child = kids[i];
            if (!child) {
            } else if (Array.isArray(child)) {
                child.map((c) => element.appendChild(c.nodeType == null ?
                    document.createTextNode(c.toString()) : c))
            }
            else {
                element.appendChild(
                    child.nodeType == null ?
                        document.createTextNode(child.toString()) : child);
            }
        }
        return element;
    }
    static domrender(els, node) {
        deletechildren(node, false);
        node.appendChild(els);
    }
};

//Default configuration
React._config = {
    root: "https://archive.org",
}