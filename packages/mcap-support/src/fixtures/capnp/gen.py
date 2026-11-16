# Regenerates the fixtures: uvx --with pycapnp python -I gen.py (run in this directory)

import capnp, os, sys, json
d=os.path.dirname(capnp.__file__)
S=capnp.load(os.path.join(d,'schema.capnp'), imports=[os.path.dirname(d)])
T=capnp.load('test.capnp')
nodes={}
def add_struct(sch):
    n=sch.node
    if n.id in nodes: return
    nodes[n.id]=n
    for f in n.struct.fields:
        fs=sch.fields[f.name]
        if f.which()=='group':
            add_struct(fs.schema); continue
        add_type(f.slot.type, fs.schema if f.slot.type.which() in ('struct','enum','list') else None)
def add_type(t, sch):
    w=t.which()
    if w=='struct': add_struct(sch)
    elif w=='enum': nodes.setdefault(sch.node.id, sch.node)
    elif w=='list':
        add_type(t.list.elementType, sch.elementType if t.list.elementType.which() in ('struct','enum','list') else None)
add_struct(T.All.schema)
add_struct(T.Amp.schema)
req=S.CodeGeneratorRequest.new_message()
ns=req.init('nodes', len(nodes))
for i,n in enumerate(nodes.values()):
    with S.Node.from_bytes(n.as_builder().to_bytes()) as r:
        ns[i]=r
open('schema.bin','wb').write(req.to_bytes())
print("root", T.All.schema.node.displayName, len(nodes))

m=T.All.new_message()
m.b=True; m.i8=-8; m.i16=-1600; m.i32=-320000; m.i64=-(2**62); m.u8=250; m.u16=65000; m.u32=4000000000; m.u64=2**63+5
m.f32=1.25; m.f64=-2.5e300; m.text="héllo"; m.data=b'\x00\x01\xff'; m.color='green'
m.point.x=1; m.point.y=2
ps=m.init('points',2); ps[0].x=3; ps[1].y=4
m.floats=[0.5,1.5,2.5]; m.bools=[True,False,True,True,False,False,False,False,True]
m.texts=["a","","bc"]; m.nested=[[1,2],[],[3]]; m.colors=['blue','red']
m.defI32=7; m.defF64=0; m.defB=False
m.word="w"; m.grp.a=-3; m.grp.b="g"; sq=m.shape.init("square"); sq.x=9
m.i64s=[-1, 2**60]; m.u8s=[1,2,3]; m.datas=[b'ab', b'']
s=m.init('self'); s.i32=5; s.num=11
open('msg_full.bin','wb').write(m.to_bytes())
e=T.All.new_message()
open('msg_empty.bin','wb').write(e.to_bytes())
# multi-segment: big data forces far pointer to new segment
b=T.All.new_message()
b.i32=1
b.u8s=list(range(256))*40
b.floats=[float(i) for i in range(3000)]
b.text="tail"
segs=b.to_segments()
print("segments", len(segs))
open('msg_big.bin','wb').write(b.to_bytes())
os._exit(0)  # pycapnp can hang on interpreter exit
